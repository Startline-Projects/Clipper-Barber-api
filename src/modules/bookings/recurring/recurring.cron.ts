import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../../supabase/supabase.service';

// Fires once per active subscription that has exactly one remaining upcoming
// booking. Uses last_booking_notification_sent_at as the idempotency guard so
// the notification only fires once per window.
@Injectable()
export class RecurringBookingsCron {
  private readonly logger = new Logger(RecurringBookingsCron.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  public async handleOneBookingRemaining(): Promise<void> {
    const { data: candidates, error } = await this.db
      .from('recurring_bookings')
      .select('id')
      .eq('status', 'active')
      .is('last_booking_notification_sent_at', null);

    if (error) {
      this.logger.error(`Failed to scan recurring_bookings: ${error.message}`);
      return;
    }
    if (!candidates || candidates.length === 0) return;

    const nowIso = new Date().toISOString();

    for (const c of candidates) {
      const id = c.id as string;
      const { count, error: countError } = await this.db
        .from('bookings')
        .select('id', { head: true, count: 'exact' })
        .eq('recurring_booking_id', id)
        .gte('scheduled_at', nowIso)
        .in('status', ['pending', 'confirmed']);

      if (countError) {
        this.logger.warn(`Count failed for recurring ${id}: ${countError.message}`);
        continue;
      }
      if ((count ?? 0) !== 1) continue;

      // TODO: notify client that only one booking remains and renewal is available
      const { error: updateError } = await this.db
        .from('recurring_bookings')
        .update({ last_booking_notification_sent_at: nowIso })
        .eq('id', id)
        .is('last_booking_notification_sent_at', null);

      if (updateError) {
        this.logger.warn(`Failed to set notification marker on ${id}: ${updateError.message}`);
      }
    }
  }
}
