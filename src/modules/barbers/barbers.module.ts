import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  BarbersController,
  BarberBookingsController,
  BarberProfileController,
  BarberSettingsController,
} from './barbers.controller';
import { BarbersService } from './barbers.service';
import { BarberServicesController } from './services/barber-services.controller';
import { BarberServicesService } from './services/barber-services.service';
import { BookingsModule } from '../bookings/bookings.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    BookingsModule,
    PaymentsModule,
    MulterModule.register({
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  ],
  controllers: [
    BarbersController,
    BarberBookingsController,
    BarberProfileController,
    BarberSettingsController,
    BarberServicesController,
  ],
  providers: [BarbersService, BarberServicesService],
  exports: [BarberServicesService],
})
export class BarbersModule {}
