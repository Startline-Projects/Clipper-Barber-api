import { Global, Module } from '@nestjs/common';
import {
  BarberNotificationSettingsController,
  BarberNotificationsController,
  ClientNotificationsController,
  DeviceTokenController,
} from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { ExpoPushService } from './expo-push.service';
import { RecurringExpiringCron } from './recurring-expiring.cron';

@Global()
@Module({
  controllers: [
    DeviceTokenController,
    BarberNotificationsController,
    BarberNotificationSettingsController,
    ClientNotificationsController,
  ],
  providers: [NotificationsService, ExpoPushService, RecurringExpiringCron],
  exports: [NotificationsService],
})
export class NotificationsModule {}
