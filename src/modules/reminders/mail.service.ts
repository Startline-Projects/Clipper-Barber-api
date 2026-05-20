import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  ok: boolean;
  messageId: string | null;
  error: string | null;
}

// Thin, injectable wrapper over the Resend SDK so dispatch logic can be unit
// tested with a mock. The sending domain behind RESEND_FROM_EMAIL must be
// verified in Resend before delivery works. Config is read lazily-tolerant:
// the app boots without the keys, but send() fails fast with a clear error
// so a missing key never silently drops reminders.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly client: Resend | null;
  private readonly fromEmail: string | undefined;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    this.fromEmail = this.configService.get<string>('RESEND_FROM_EMAIL');
    this.client = apiKey ? new Resend(apiKey) : null;
  }

  public async send(input: SendEmailInput): Promise<SendEmailResult> {
    if (!this.client || !this.fromEmail) {
      const error = 'Resend not configured (RESEND_API_KEY / RESEND_FROM_EMAIL missing)';
      this.logger.error(error);
      return { ok: false, messageId: null, error };
    }

    try {
      const { data, error } = await this.client.emails.send({
        from: this.fromEmail,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });

      if (error) {
        this.logger.warn(`Resend rejected email to ${input.to}: ${error.message}`);
        return { ok: false, messageId: null, error: error.message };
      }

      return { ok: true, messageId: data?.id ?? null, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Resend error';
      this.logger.error(`Resend send threw for ${input.to}: ${message}`);
      return { ok: false, messageId: null, error: message };
    }
  }
}
