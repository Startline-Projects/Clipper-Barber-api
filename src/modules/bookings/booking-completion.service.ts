import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface CompletedBookingRow {
  id: string;
  status: string;
}

@Injectable()
export class BookingCompletionService {
  private readonly logger = new Logger(BookingCompletionService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  // Transition a single booking to 'completed'. Idempotent: the WHERE filter
  // on status = 'confirmed' means a concurrent cron pass becomes a no-op.
  // Used by both barber manual complete and the cron scan.
  public async completeBooking(
    bookingId: string,
    barberId?: string
  ): Promise<CompletedBookingRow> {
    const nowIso = new Date().toISOString();

    let query = this.db
      .from('bookings')
      .update({
        status: 'completed',
        review_prompt_sent_at: nowIso,
      })
      .eq('id', bookingId)
      .eq('status', 'confirmed')
      .is('review_prompt_sent_at', null);

    if (barberId) query = query.eq('barber_id', barberId);

    const { data: updatedFresh, error: freshError } = await query
      .select('id, status')
      .maybeSingle();

    if (freshError) {
      throw new InternalServerErrorException('Failed to complete booking');
    }

    if (updatedFresh) {
      return {
        id: updatedFresh.id as string,
        status: updatedFresh.status as string,
      };
    }

    // Either review_prompt_sent_at was already set, or the status wasn't
    // 'confirmed'. Flip status only, without touching the marker.
    let fallback = this.db
      .from('bookings')
      .update({ status: 'completed' })
      .eq('id', bookingId)
      .eq('status', 'confirmed');

    if (barberId) fallback = fallback.eq('barber_id', barberId);

    const { data: fallbackRow, error: fallbackError } = await fallback
      .select('id, status')
      .maybeSingle();

    if (fallbackError) {
      throw new InternalServerErrorException('Failed to complete booking');
    }

    if (fallbackRow) {
      return {
        id: fallbackRow.id as string,
        status: fallbackRow.status as string,
      };
    }

    // Already completed by another path — read current row
    let read = this.db.from('bookings').select('id, status').eq('id', bookingId);
    if (barberId) read = read.eq('barber_id', barberId);
    const { data: current, error: readError } = await read.maybeSingle();
    if (readError || !current) {
      throw new InternalServerErrorException('Failed to read booking');
    }
    return { id: current.id as string, status: current.status as string };
  }

  // Cron entry point: finds all confirmed bookings whose window has already
  // elapsed (scheduled_at + duration < now) and marks them completed.
  public async runCompletionSweep(): Promise<number> {
    const nowIso = new Date().toISOString();

    // Pull candidates — bookings confirmed with scheduled_at already past.
    // Duration check is enforced in-process so the query remains index-friendly.
    const { data, error } = await this.db
      .from('bookings')
      .select('id, scheduled_at, duration_minutes, review_prompt_sent_at')
      .eq('status', 'confirmed')
      .lte('scheduled_at', nowIso)
      .limit(500);

    if (error) {
      this.logger.error('Completion cron failed to load candidates', error.message);
      return 0;
    }

    const candidates = data ?? [];
    const nowMs = Date.now();
    let completed = 0;

    for (const row of candidates) {
      const scheduledAt = new Date(row.scheduled_at as string);
      const duration = (row.duration_minutes as number | null) ?? 0;
      const endMs = scheduledAt.getTime() + duration * 60_000;
      if (endMs >= nowMs) continue;

      try {
        await this.completeBooking(row.id as string);
        completed++;
      } catch (err) {
        this.logger.warn(
          `Completion cron: failed to complete booking ${row.id as string}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    if (completed > 0) {
      this.logger.log(`Completion cron marked ${completed} booking(s) as completed`);
    }

    return completed;
  }
}
