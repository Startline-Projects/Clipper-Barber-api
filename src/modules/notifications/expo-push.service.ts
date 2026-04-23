import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';

export interface ExpoPushPayload {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface ExpoPushOutcome {
  token: string;
  ok: boolean;
  // When ok=false and the token is permanently unregistered (stale install,
  // reinstall, logged-out device), isInvalidToken is true so the caller
  // can drop it from device_tokens.
  isInvalidToken: boolean;
}

// Thin wrapper over expo-server-sdk:
//   * validates token format
//   * chunks large fan-outs (Expo caps each request at 100 tickets)
//   * surfaces per-token outcomes so the caller can prune stale tokens
@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);
  private readonly expo: Expo;

  constructor(private readonly configService: ConfigService) {
    const accessToken = this.configService.get<string>('EXPO_ACCESS_TOKEN');
    this.expo = new Expo(accessToken ? { accessToken } : {});
  }

  public isValidExpoToken(token: string): boolean {
    return Expo.isExpoPushToken(token);
  }

  public async send(payloads: ExpoPushPayload[]): Promise<ExpoPushOutcome[]> {
    if (payloads.length === 0) return [];

    const valid: ExpoPushMessage[] = [];
    const outcomes: ExpoPushOutcome[] = [];

    for (const p of payloads) {
      if (!this.isValidExpoToken(p.to)) {
        outcomes.push({ token: p.to, ok: false, isInvalidToken: true });
        continue;
      }
      valid.push({
        to: p.to,
        title: p.title,
        body: p.body,
        data: p.data ?? {},
        sound: 'default',
        priority: 'high',
      });
    }

    if (valid.length === 0) return outcomes;

    const chunks = this.expo.chunkPushNotifications(valid);

    for (const chunk of chunks) {
      try {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        this.attachTicketOutcomes(chunk, tickets, outcomes);
      } catch (err) {
        this.logger.error(
          `Expo push chunk failed — marking ${chunk.length} token(s) as failed`,
          err as Error,
        );
        for (const msg of chunk) {
          outcomes.push({
            token: Array.isArray(msg.to) ? msg.to[0] : msg.to,
            ok: false,
            isInvalidToken: false,
          });
        }
      }
    }

    return outcomes;
  }

  private attachTicketOutcomes(
    chunk: ExpoPushMessage[],
    tickets: ExpoPushTicket[],
    outcomes: ExpoPushOutcome[],
  ): void {
    chunk.forEach((msg, i) => {
      const ticket = tickets[i];
      const token = Array.isArray(msg.to) ? msg.to[0] : msg.to;
      if (ticket.status === 'ok') {
        outcomes.push({ token, ok: true, isInvalidToken: false });
        return;
      }
      const isInvalidToken =
        ticket.details?.error === 'DeviceNotRegistered' ||
        ticket.details?.error === 'InvalidCredentials';
      this.logger.warn(
        `Expo push error for token ${this.maskToken(token)}: ${ticket.message}`,
      );
      outcomes.push({ token, ok: false, isInvalidToken });
    });
  }

  private maskToken(token: string): string {
    if (token.length <= 12) return token;
    return `${token.slice(0, 8)}...${token.slice(-4)}`;
  }
}
