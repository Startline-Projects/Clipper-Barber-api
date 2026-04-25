import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from './notifications.service';
import { NotificationTypeDto } from './dto/notification.dto';

// Fires daily at 08:00 server-local. For every active recurring subscription
// whose remaining upcoming appointment count has dropped to EXPIRING_THRESHOLD,
// sends `recurring_expiring` to the client exactly once — the
// `expiry_notified` flag on the subscription row guards against re-firing.
const EXPIRING_THRESHOLD = 1;

interface RecurringRow {
  id: string;
  client_id: string;
  barber_id: string;
}

@Injectable()
export class RecurringExpiringCron {
  private readonly logger = new Logger(RecurringExpiringCron.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  @Cron('0 8 * * *')
  public async handleCron(): Promise<void> {
    await this.runExpiringSweep();
  }

  public async runExpiringSweep(): Promise<void> {
    const { data, error } = await this.db
      .from('recurring_bookings')
      .select('id, client_id, barber_id')
      .eq('status', 'active')
      .eq('expiry_notified', false);

    if (error) {
      this.logger.error(`Failed to fetch active recurring bookings: ${error.message}`);
      return;
    }

    const rows = (data ?? []) as RecurringRow[];
    if (rows.length === 0) return;

    const nowIso = new Date().toISOString();
    for (const row of rows) {
      try {
        const remaining = await this.countRemainingAppointments(row.id, nowIso);
        if (remaining > EXPIRING_THRESHOLD) continue;

        await this.notificationsService.createAndSendNotification({
          recipientId: row.client_id,
          recipientType: 'client',
          senderId: row.barber_id,
          type: NotificationTypeDto.RECURRING_EXPIRING,
          recurringBookingId: row.id,
        });

        await this.markNotified(row.id);
      } catch (err) {
        this.logger.error(
          `Failed to process expiring-check for recurring ${row.id}`,
          err as Error,
        );
      }
    }
  }

  private async countRemainingAppointments(
    recurringBookingId: string,
    nowIso: string,
  ): Promise<number> {
    const { count, error } = await this.db
      .from('bookings')
      .select('id', { head: true, count: 'exact' })
      .eq('recurring_booking_id', recurringBookingId)
      .gte('scheduled_at', nowIso)
      .in('status', ['pending', 'confirmed']);

    if (error) {
      this.logger.error(`Failed to count remaining for ${recurringBookingId}: ${error.message}`);
      return Number.MAX_SAFE_INTEGER;
    }
    return count ?? 0;
  }

  private async markNotified(recurringBookingId: string): Promise<void> {
    const { error } = await this.db
      .from('recurring_bookings')
      .update({ expiry_notified: true })
      .eq('id', recurringBookingId);

    if (error) {
      this.logger.error(
        `Failed to mark expiry_notified for ${recurringBookingId}: ${error.message}`,
      );
    }
  }
}
