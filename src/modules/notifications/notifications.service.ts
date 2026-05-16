import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { ExpoPushService } from './expo-push.service';
import {
  DevicePlatformDto,
  RegisterDeviceTokenDto,
  RegisterDeviceTokenResponseDto,
} from './dto/register-device-token.dto';
import { RemoveDeviceTokenResponseDto } from './dto/remove-device-token.dto';
import {
  ClearAllNotificationsResponseDto,
  ListNotificationsResponseDto,
  MarkNotificationReadResponseDto,
  NotificationDto,
  NotificationTypeDto,
  UnreadCountResponseDto,
} from './dto/notification.dto';
import {
  NotificationSettingsResponseDto,
  UpdateNotificationSettingsDto,
} from './dto/notification-settings.dto';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export type RecipientType = 'client' | 'barber';

// Narrow set passed by triggers — NotificationsService fills in the
// human-readable title/body based on `type` plus the looked-up actor
// (barber name / client name) and booking (service name, price, time).
export interface CreateNotificationInput {
  recipientId: string;
  recipientType: RecipientType;
  senderId: string;
  type: NotificationTypeDto;
  bookingId?: string | null;
  recurringBookingId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  // Plain-text body of the chat message, used verbatim (truncated) as the
  // notification body for NEW_MESSAGE. Ignored for booking / recurring types.
  messageBody?: string;
  override?: Partial<NotificationFormatSeed>;
}

const CHAT_PREVIEW_MAX_CHARS = 120;

export interface NotificationFormatSeed {
  actorName: string;
  serviceName: string;
  priceUsd: number;
  scheduledAtUtc: string | null;
  timezone: string;
}

// Types whose recipient is always a barber. RECURRING_PAUSED/RECURRING_RESUMED
// are intentionally absent — they fire to the party that did NOT initiate the
// action, so the recipient can be either a client or a barber.
const BARBER_TYPES: ReadonlySet<NotificationTypeDto> = new Set([
  NotificationTypeDto.NEW_BOOKING,
  NotificationTypeDto.CANCELLED_BOOKING,
  NotificationTypeDto.NEW_RECURRING_REQUEST,
  NotificationTypeDto.RECURRING_CANCELLED,
  NotificationTypeDto.RECURRING_ARRANGEMENT_ACCEPTED,
  NotificationTypeDto.RECURRING_ARRANGEMENT_REJECTED,
]);

const RECURRING_CATEGORY_TYPES: ReadonlySet<NotificationTypeDto> = new Set([
  NotificationTypeDto.NEW_RECURRING_REQUEST,
  NotificationTypeDto.RECURRING_CANCELLED,
  NotificationTypeDto.RECURRING_PAUSED,
  NotificationTypeDto.RECURRING_RESUMED,
  NotificationTypeDto.RECURRING_ARRANGEMENT_OFFERED,
  NotificationTypeDto.RECURRING_ARRANGEMENT_ACCEPTED,
  NotificationTypeDto.RECURRING_ARRANGEMENT_REJECTED,
]);

const TITLE_BY_TYPE: Record<NotificationTypeDto, string> = {
  [NotificationTypeDto.NEW_BOOKING]: 'New Booking',
  [NotificationTypeDto.CANCELLED_BOOKING]: 'Booking Cancelled',
  [NotificationTypeDto.NEW_RECURRING_REQUEST]: 'New Recurring Request',
  [NotificationTypeDto.RECURRING_CANCELLED]: 'Recurring Cancelled',
  [NotificationTypeDto.RECURRING_PAUSED]: 'Recurring Paused',
  [NotificationTypeDto.RECURRING_RESUMED]: 'Recurring Resumed',
  [NotificationTypeDto.BOOKING_CONFIRMED]: 'Booking Confirmed',
  [NotificationTypeDto.BOOKING_CANCELLED]: 'Booking Cancelled',
  [NotificationTypeDto.RECURRING_ACCEPTED]: 'Recurring Accepted',
  [NotificationTypeDto.RECURRING_REFUSED]: 'Recurring Refused',
  [NotificationTypeDto.RECURRING_EXPIRING]: 'Recurring Expiring',
  // NEW_MESSAGE builds its title dynamically from the sender's name.
  [NotificationTypeDto.NEW_MESSAGE]: 'New Message',
  [NotificationTypeDto.RECURRING_ARRANGEMENT_OFFERED]: 'Recurring Arrangement Offer',
  [NotificationTypeDto.RECURRING_ARRANGEMENT_ACCEPTED]: 'Recurring Arrangement Accepted',
  [NotificationTypeDto.RECURRING_ARRANGEMENT_REJECTED]: 'Recurring Arrangement Declined',
  [NotificationTypeDto.SUBSCRIPTION_ACTIVATED]: 'Subscription Active',
  [NotificationTypeDto.SUBSCRIPTION_REACTIVATED]: 'Subscription Reactivated',
  [NotificationTypeDto.SUBSCRIPTION_CANCEL_SCHEDULED]: 'Cancellation Scheduled',
  [NotificationTypeDto.SUBSCRIPTION_CANCELLED]: 'Subscription Ended',
  [NotificationTypeDto.SUBSCRIPTION_PAST_DUE]: 'Payment Failed',
};

const SUBSCRIPTION_BODY_BY_TYPE: Partial<Record<NotificationTypeDto, string>> = {
  [NotificationTypeDto.SUBSCRIPTION_ACTIVATED]:
    'Your subscription is now active. Enjoy full access.',
  [NotificationTypeDto.SUBSCRIPTION_REACTIVATED]:
    'Your payment went through. Your subscription is active again.',
  [NotificationTypeDto.SUBSCRIPTION_CANCEL_SCHEDULED]:
    'Your subscription will end at the close of the current billing period. You can reactivate any time before then.',
  [NotificationTypeDto.SUBSCRIPTION_CANCELLED]:
    'Your subscription has ended. Re-subscribe any time to restore access.',
  [NotificationTypeDto.SUBSCRIPTION_PAST_DUE]:
    'We were unable to charge your card. Please update your payment method to keep your subscription active.',
};

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  is_read: boolean;
  booking_id: string | null;
  recurring_booking_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
  created_at: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly expoPush: ExpoPushService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  // ────────────────────────────────────────────────────────────
  // Device tokens — register / remove
  // ────────────────────────────────────────────────────────────

  public async registerDeviceToken(
    userId: string,
    userType: RecipientType,
    dto: RegisterDeviceTokenDto,
  ): Promise<RegisterDeviceTokenResponseDto> {
    // Free the token from any other account on the same phone (reinstall
    // or account swap) before upserting the current user's row.
    const { error: cleanupError } = await this.db
      .from('device_tokens')
      .delete()
      .eq('token', dto.token)
      .neq('user_id', userId);
    if (cleanupError) {
      throw new InternalServerErrorException('Failed to cleanup stale device tokens');
    }

    const { data, error } = await this.db
      .from('device_tokens')
      .upsert(
        {
          user_id: userId,
          user_type: userType,
          token: dto.token,
          platform: dto.platform,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,platform' },
      )
      .select('id, token, platform')
      .single();

    if (error || !data) {
      throw new InternalServerErrorException('Failed to register device token');
    }

    return {
      id: data.id as string,
      token: data.token as string,
      platform: data.platform as DevicePlatformDto,
    };
  }

  public async removeDeviceToken(
    userId: string,
    token: string,
  ): Promise<RemoveDeviceTokenResponseDto> {
    const { error, count } = await this.db
      .from('device_tokens')
      .delete({ count: 'exact' })
      .eq('user_id', userId)
      .eq('token', token);

    if (error) throw new InternalServerErrorException('Failed to remove device token');
    return { removed: (count ?? 0) > 0 };
  }

  // ────────────────────────────────────────────────────────────
  // Barber notification settings
  // ────────────────────────────────────────────────────────────

  public async getBarberSettings(
    barberId: string,
  ): Promise<NotificationSettingsResponseDto> {
    const row = await this.ensureBarberSettings(barberId);
    return {
      normal_bookings: row.normal_bookings,
      recurring_bookings: row.recurring_bookings,
    };
  }

  public async updateBarberSettings(
    barberId: string,
    dto: UpdateNotificationSettingsDto,
  ): Promise<NotificationSettingsResponseDto> {
    await this.ensureBarberSettings(barberId);

    const { data, error } = await this.db
      .from('barber_notification_settings')
      .update({
        normal_bookings: dto.normal_bookings,
        recurring_bookings: dto.recurring_bookings,
      })
      .eq('barber_id', barberId)
      .select('normal_bookings, recurring_bookings')
      .single();

    if (error || !data) {
      throw new InternalServerErrorException('Failed to update notification settings');
    }

    return {
      normal_bookings: data.normal_bookings as boolean,
      recurring_bookings: data.recurring_bookings as boolean,
    };
  }

  private async ensureBarberSettings(barberId: string): Promise<{
    normal_bookings: boolean;
    recurring_bookings: boolean;
  }> {
    const { data, error } = await this.db
      .from('barber_notification_settings')
      .select('normal_bookings, recurring_bookings')
      .eq('barber_id', barberId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to fetch notification settings');
    if (data) {
      return {
        normal_bookings: data.normal_bookings as boolean,
        recurring_bookings: data.recurring_bookings as boolean,
      };
    }

    // Lazy seed — covers barbers created before the trigger was added
    const { data: inserted, error: insertError } = await this.db
      .from('barber_notification_settings')
      .insert({ barber_id: barberId })
      .select('normal_bookings, recurring_bookings')
      .single();

    if (insertError || !inserted) {
      throw new InternalServerErrorException('Failed to seed notification settings');
    }
    return {
      normal_bookings: inserted.normal_bookings as boolean,
      recurring_bookings: inserted.recurring_bookings as boolean,
    };
  }

  // ────────────────────────────────────────────────────────────
  // Notification feed — list / read receipts / unread count
  // ────────────────────────────────────────────────────────────

  public async listNotifications(
    recipientId: string,
    recipientType: RecipientType,
    page: number | undefined,
    limit: number | undefined,
  ): Promise<ListNotificationsResponseDto> {
    const currentPage = page ?? DEFAULT_PAGE;
    const perPage = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const { count, error: countError } = await this.db
      .from('notifications')
      .select('id', { head: true, count: 'exact' })
      .eq('recipient_id', recipientId)
      .eq('recipient_type', recipientType);

    if (countError) throw new InternalServerErrorException('Failed to count notifications');

    const totalNotifications = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalNotifications / perPage));
    const startIndex = (currentPage - 1) * perPage;

    const { data, error } = await this.db
      .from('notifications')
      .select(
        'id, type, title, body, data, is_read, booking_id, recurring_booking_id, conversation_id, message_id, created_at',
      )
      .eq('recipient_id', recipientId)
      .eq('recipient_type', recipientType)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(startIndex, startIndex + perPage - 1);

    if (error) throw new InternalServerErrorException('Failed to fetch notifications');

    const rows = (data ?? []) as NotificationRow[];
    const notifications: NotificationDto[] = rows.map((r) => this.mapNotificationRow(r));

    return {
      notifications,
      pagination: {
        currentPage,
        totalPages,
        totalNotifications,
        limit: perPage,
        hasNextPage: currentPage < totalPages,
      },
    };
  }

  public async markAsRead(
    recipientId: string,
    recipientType: RecipientType,
    notificationId: string,
  ): Promise<MarkNotificationReadResponseDto> {
    const { data: existing, error: fetchError } = await this.db
      .from('notifications')
      .select('id, recipient_id, recipient_type, is_read')
      .eq('id', notificationId)
      .maybeSingle();

    if (fetchError) throw new InternalServerErrorException('Failed to fetch notification');
    if (!existing) throw new NotFoundException('Notification not found');
    if (existing.recipient_id !== recipientId || existing.recipient_type !== recipientType) {
      throw new NotFoundException('Notification not found');
    }

    if (existing.is_read) {
      return { id: notificationId, isRead: true };
    }

    const { data, error } = await this.db
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('recipient_id', recipientId)
      .select('id, is_read')
      .single();

    if (error || !data) throw new InternalServerErrorException('Failed to mark as read');

    return { id: data.id as string, isRead: data.is_read as boolean };
  }

  public async clearAll(
    recipientId: string,
    recipientType: RecipientType,
  ): Promise<ClearAllNotificationsResponseDto> {
    const { error, count } = await this.db
      .from('notifications')
      .update({ is_read: true }, { count: 'exact' })
      .eq('recipient_id', recipientId)
      .eq('recipient_type', recipientType)
      .eq('is_read', false);

    if (error) throw new InternalServerErrorException('Failed to clear notifications');
    return { updated: count ?? 0 };
  }

  public async getUnreadCount(
    recipientId: string,
    recipientType: RecipientType,
  ): Promise<UnreadCountResponseDto> {
    const { count, error } = await this.db
      .from('notifications')
      .select('id', { head: true, count: 'exact' })
      .eq('recipient_id', recipientId)
      .eq('recipient_type', recipientType)
      .eq('is_read', false);

    if (error) throw new InternalServerErrorException('Failed to fetch unread count');
    return { unreadCount: count ?? 0 };
  }

  // ────────────────────────────────────────────────────────────
  // Main trigger entry point
  // ────────────────────────────────────────────────────────────

  // Flow:
  //   1. Short-circuit on bad recipient_type / disabled barber category.
  //   2. Format title/body from looked-up booking + actor names.
  //   3. Persist notification row (service-role bypasses RLS).
  //   4. Fan out to every device_token for the recipient.
  //   5. Prune tokens Expo flagged as permanently invalid.
  //
  // Swallows all exceptions so callers never roll back their main action
  // because of a push failure.
  public async createAndSendNotification(input: CreateNotificationInput): Promise<void> {
    try {
      // Chat pushes don't run through the booking-centric format pipeline
      // and bypass the barber category toggles (chat is always on).
      if (input.type === NotificationTypeDto.NEW_MESSAGE) {
        await this.createAndSendChatNotification(input);
        return;
      }

      if (!this.isRecipientValidForType(input.type, input.recipientType)) return;

      if (input.recipientType === 'barber') {
        const allowed = await this.isBarberCategoryAllowed(input.recipientId, input.type);
        if (!allowed) return;
      }

      const seed = await this.buildFormatSeed(input);
      const title = TITLE_BY_TYPE[input.type];
      const body = this.formatBody(seed);

      const inserted = await this.persistNotification(input, title, body);
      if (!inserted) return;

      await this.dispatchPush(input.recipientId, title, body, {
        notificationId: inserted.id,
        type: input.type,
        bookingId: input.bookingId ?? null,
        recurringBookingId: input.recurringBookingId ?? null,
      });
    } catch (err) {
      this.logger.error(
        `createAndSendNotification failed for type=${input.type} recipient=${input.recipientId}`,
        err as Error,
      );
    }
  }

  // Subscription lifecycle pushes — bypass the booking-centric formatter
  // and the barber category toggles (recipient is always a client).
  public async createAndSendSubscriptionNotification(
    clientUserId: string,
    type: NotificationTypeDto,
  ): Promise<void> {
    try {
      const body = SUBSCRIPTION_BODY_BY_TYPE[type];
      if (!body) {
        this.logger.warn(`No subscription body template for ${type}`);
        return;
      }
      const title = TITLE_BY_TYPE[type];

      const { data, error } = await this.db
        .from('notifications')
        .insert({
          recipient_id: clientUserId,
          recipient_type: 'client',
          sender_id: clientUserId,
          type,
          title,
          body,
          data: {},
        })
        .select('id')
        .single();

      if (error || !data) {
        this.logger.error(
          `Failed to persist subscription notification: ${error?.message ?? 'unknown'}`,
        );
        return;
      }

      await this.dispatchPush(clientUserId, title, body, {
        notificationId: data.id as string,
        type,
      });
    } catch (err) {
      this.logger.error(
        `createAndSendSubscriptionNotification failed for type=${type} recipient=${clientUserId}`,
        err as Error,
      );
    }
  }

  private async createAndSendChatNotification(
    input: CreateNotificationInput,
  ): Promise<void> {
    if (!input.conversationId || !input.messageId || !input.messageBody) {
      this.logger.warn('NEW_MESSAGE notification missing conversation/message context');
      return;
    }

    const senderName =
      input.recipientType === 'barber'
        ? await this.fetchClientName(input.senderId)
        : (await this.fetchBarberDisplay(input.senderId)).name;

    const title = `New message from ${senderName}`;
    const body = this.truncate(input.messageBody, CHAT_PREVIEW_MAX_CHARS);

    const { data, error } = await this.db
      .from('notifications')
      .insert({
        recipient_id: input.recipientId,
        recipient_type: input.recipientType,
        sender_id: input.senderId,
        conversation_id: input.conversationId,
        message_id: input.messageId,
        type: input.type,
        title,
        body,
        data: {},
      })
      .select('id')
      .single();

    if (error || !data) {
      this.logger.error(
        `Failed to persist chat notification: ${error?.message ?? 'unknown'}`,
      );
      return;
    }

    await this.dispatchPush(input.recipientId, title, body, {
      notificationId: data.id as string,
      type: input.type,
      conversationId: input.conversationId,
      messageId: input.messageId,
    });
  }

  private truncate(text: string, max: number): string {
    const trimmed = text.trim();
    return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
  }

  private isRecipientValidForType(
    type: NotificationTypeDto,
    recipientType: RecipientType,
  ): boolean {
    // Pause/Resume can target either party (the one who didn't initiate).
    if (
      type === NotificationTypeDto.RECURRING_PAUSED ||
      type === NotificationTypeDto.RECURRING_RESUMED
    ) {
      return true;
    }
    const isBarberType = BARBER_TYPES.has(type);
    if (isBarberType && recipientType !== 'barber') return false;
    if (!isBarberType && recipientType !== 'client') return false;
    return true;
  }

  private async isBarberCategoryAllowed(
    barberId: string,
    type: NotificationTypeDto,
  ): Promise<boolean> {
    const settings = await this.ensureBarberSettings(barberId);
    if (RECURRING_CATEGORY_TYPES.has(type)) return settings.recurring_bookings;
    return settings.normal_bookings;
  }

  private async persistNotification(
    input: CreateNotificationInput,
    title: string,
    body: string,
  ): Promise<{ id: string } | null> {
    const { data, error } = await this.db
      .from('notifications')
      .insert({
        recipient_id: input.recipientId,
        recipient_type: input.recipientType,
        sender_id: input.senderId,
        booking_id: input.bookingId ?? null,
        recurring_booking_id: input.recurringBookingId ?? null,
        type: input.type,
        title,
        body,
        data: {},
      })
      .select('id')
      .single();

    if (error || !data) {
      this.logger.error(`Failed to persist notification: ${error?.message ?? 'unknown'}`);
      return null;
    }
    return { id: data.id as string };
  }

  private async dispatchPush(
    recipientId: string,
    title: string,
    body: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const { data: tokenRows, error } = await this.db
      .from('device_tokens')
      .select('token')
      .eq('user_id', recipientId);

    if (error) {
      this.logger.error(`Failed to fetch device tokens for ${recipientId}: ${error.message}`);
      return;
    }

    const tokens = (tokenRows ?? []).map((r) => r.token as string);
    if (tokens.length === 0) return;

    const outcomes = await this.expoPush.send(
      tokens.map((t) => ({ to: t, title, body, data })),
    );

    const invalidTokens = outcomes.filter((o) => o.isInvalidToken).map((o) => o.token);
    if (invalidTokens.length > 0) {
      await this.pruneInvalidTokens(invalidTokens);
    }
  }

  private async pruneInvalidTokens(tokens: string[]): Promise<void> {
    const { error } = await this.db.from('device_tokens').delete().in('token', tokens);
    if (error) {
      this.logger.error(`Failed to prune ${tokens.length} stale token(s): ${error.message}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Formatting — "Name — Service — $Price — Date at Time"
  // ────────────────────────────────────────────────────────────

  private async buildFormatSeed(
    input: CreateNotificationInput,
  ): Promise<NotificationFormatSeed> {
    const seed: NotificationFormatSeed = {
      actorName: 'Unknown',
      serviceName: 'Service',
      priceUsd: 0,
      scheduledAtUtc: null,
      timezone: 'UTC',
    };

    const override = input.override;
    if (override) Object.assign(seed, override);

    // The "actor" shown in the body is always the OTHER party. Overrides
    // win for callers that already know the display name.
    if (input.recipientType === 'barber' && !override?.actorName) {
      seed.actorName = await this.fetchClientName(input.senderId);
    } else if (input.recipientType === 'client' && !override?.actorName) {
      const barber = await this.fetchBarberDisplay(input.senderId);
      seed.actorName = barber.name;
      if (!override?.timezone) seed.timezone = barber.timezone;
    }

    if (input.bookingId) {
      await this.enrichFromBooking(input.bookingId, seed, override);
    } else if (input.recurringBookingId) {
      await this.enrichFromRecurring(input.recurringBookingId, seed, override);
    }

    return seed;
  }

  private async enrichFromBooking(
    bookingId: string,
    seed: NotificationFormatSeed,
    override?: Partial<NotificationFormatSeed>,
  ): Promise<void> {
    const { data } = await this.db
      .from('bookings')
      .select('barber_id, scheduled_at, price_usd, barber_service_id')
      .eq('id', bookingId)
      .maybeSingle();
    if (!data) return;

    if (override?.priceUsd === undefined) seed.priceUsd = Number(data.price_usd);
    if (override?.scheduledAtUtc === undefined) {
      seed.scheduledAtUtc = data.scheduled_at as string;
    }
    if (override?.timezone === undefined) {
      seed.timezone = await this.fetchBarberTimezone(data.barber_id as string);
    }
    if (override?.serviceName === undefined && data.barber_service_id) {
      seed.serviceName = await this.fetchServiceName(data.barber_service_id as string);
    }
  }

  private async enrichFromRecurring(
    recurringBookingId: string,
    seed: NotificationFormatSeed,
    override?: Partial<NotificationFormatSeed>,
  ): Promise<void> {
    const { data } = await this.db
      .from('recurring_bookings')
      .select('barber_id, price_usd, barber_service_id, slot_time, day_of_week')
      .eq('id', recurringBookingId)
      .maybeSingle();
    if (!data) return;

    if (override?.priceUsd === undefined) seed.priceUsd = Number(data.price_usd);
    if (override?.timezone === undefined) {
      seed.timezone = await this.fetchBarberTimezone(data.barber_id as string);
    }
    if (override?.serviceName === undefined && data.barber_service_id) {
      seed.serviceName = await this.fetchServiceName(data.barber_service_id as string);
    }
    if (override?.scheduledAtUtc === undefined) {
      // Recurring rows have no single scheduled_at — use the next upcoming
      // generated booking so the message still carries a concrete time.
      const { data: nextBooking } = await this.db
        .from('bookings')
        .select('scheduled_at')
        .eq('recurring_booking_id', recurringBookingId)
        .gte('scheduled_at', new Date().toISOString())
        .in('status', ['pending', 'confirmed'])
        .order('scheduled_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      seed.scheduledAtUtc = (nextBooking?.scheduled_at as string | undefined) ?? null;
    }
  }

  private formatBody(seed: NotificationFormatSeed): string {
    const parts = [seed.actorName, seed.serviceName, `$${this.formatPrice(seed.priceUsd)}`];
    if (seed.scheduledAtUtc) {
      parts.push(this.formatLocalDateTime(seed.scheduledAtUtc, seed.timezone));
    }
    return parts.join(' — ');
  }

  private formatPrice(price: number): string {
    return Number.isInteger(price) ? `${price}` : price.toFixed(2);
  }

  // "May 15, 2025 at 3:00 PM" in the barber's local timezone.
  private formatLocalDateTime(utcIso: string, timezone: string): string {
    const instant = new Date(utcIso);
    const datePart = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(instant);
    const timePart = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(instant);
    return `${datePart} at ${timePart}`;
  }

  // ────────────────────────────────────────────────────────────
  // Lookup helpers
  // ────────────────────────────────────────────────────────────

  private async fetchBarberDisplay(
    barberAuthId: string,
  ): Promise<{ name: string; timezone: string }> {
    const { data } = await this.db
      .from('barbers')
      .select('full_name, shop_name, timezone')
      .eq('user_id', barberAuthId)
      .maybeSingle();
    return {
      name:
        (data?.shop_name as string | undefined) ??
        (data?.full_name as string | undefined) ??
        'Barber',
      timezone: (data?.timezone as string | undefined) ?? 'UTC',
    };
  }

  private async fetchBarberTimezone(barberAuthId: string): Promise<string> {
    const { data } = await this.db
      .from('barbers')
      .select('timezone')
      .eq('user_id', barberAuthId)
      .maybeSingle();
    return (data?.timezone as string | undefined) ?? 'UTC';
  }

  private async fetchClientName(clientAuthId: string): Promise<string> {
    const { data } = await this.db
      .from('clients')
      .select('name')
      .eq('user_id', clientAuthId)
      .maybeSingle();
    return (data?.name as string | undefined) ?? 'Client';
  }

  private async fetchServiceName(serviceId: string): Promise<string> {
    const { data } = await this.db
      .from('barber_services')
      .select('name')
      .eq('id', serviceId)
      .maybeSingle();
    return (data?.name as string | undefined) ?? 'Service';
  }

  private mapNotificationRow(r: NotificationRow): NotificationDto {
    if (!Object.values(NotificationTypeDto).includes(r.type as NotificationTypeDto)) {
      throw new BadRequestException('Unknown notification type');
    }
    return {
      id: r.id,
      type: r.type as NotificationTypeDto,
      title: r.title,
      body: r.body,
      data: (r.data ?? {}) as Record<string, unknown>,
      isRead: r.is_read,
      bookingId: r.booking_id,
      recurringBookingId: r.recurring_booking_id,
      conversationId: r.conversation_id,
      messageId: r.message_id,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }
}
