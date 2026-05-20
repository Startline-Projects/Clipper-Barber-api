import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RemindersService } from './reminders.service';

// Every minute: dispatch due reminders, then run the safety-net reconcile so
// bookings whose precompute handler was missed still get scheduled. Both steps
// are idempotent and lock-safe (claim_due_reminders uses SKIP LOCKED), so
// overlapping ticks never double-send.
@Injectable()
export class ReminderDispatchCron {
  private readonly logger = new Logger(ReminderDispatchCron.name);
  private running = false;

  constructor(private readonly remindersService: RemindersService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  public async handleCron(): Promise<void> {
    // Skip if a previous tick is still in flight (slow Resend / large batch).
    if (this.running) return;
    this.running = true;
    try {
      await this.remindersService.dispatchDueReminders();
      await this.remindersService.reconcileUpcomingReminders();
    } catch (err) {
      this.logger.error('Reminder dispatch tick failed', err as Error);
    } finally {
      this.running = false;
    }
  }
}
