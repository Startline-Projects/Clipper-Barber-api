import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../../supabase/supabase.service';
import { RecurringBookingGeneratorService } from './recurring-booking-generator.service';

// Daily top-up for barber-initiated arrangements: keeps roughly 8 weeks of
// generated bookings ahead of "now". Stops naturally when an arrangement's
// end_date has passed or when end_count occurrences have been generated —
// computeOccurrenceDatesLocal handles both via existing-count consumption
// and date clamping. Does NOT touch client-initiated rows (those have
// their own separate cron in recurring.cron.ts).
@Injectable()
export class RecurringArrangementsCron {
  private readonly logger = new Logger(RecurringArrangementsCron.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly generator: RecurringBookingGeneratorService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  public async topUpActiveArrangements(): Promise<void> {
    const { data, error } = await this.db
      .from('recurring_bookings')
      .select('id')
      .eq('initiator', 'barber')
      .eq('status', 'active');

    if (error) {
      this.logger.error(`Top-up scan failed: ${error.message}`);
      return;
    }

    for (const row of data ?? []) {
      try {
        await this.generator.generate(row.id as string);
      } catch (err) {
        this.logger.warn(
          `Top-up failed for arrangement ${row.id as string}: ${(err as Error).message}`,
        );
      }
    }
  }
}
