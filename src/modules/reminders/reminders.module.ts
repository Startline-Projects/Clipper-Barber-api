import { Global, Module } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { MailService } from './mail.service';
import { ReminderDispatchCron } from './reminder-dispatch.cron';
import { BarberReminderSettingsController } from './reminders.controller';

// Global so BookingsService can inject RemindersService for lifecycle hooks
// without a circular module dependency (mirrors NotificationsModule).
@Global()
@Module({
  controllers: [BarberReminderSettingsController],
  providers: [RemindersService, MailService, ReminderDispatchCron],
  exports: [RemindersService],
})
export class RemindersModule {}
