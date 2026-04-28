import { Module } from '@nestjs/common';
import {
  BarbersController,
  BarberBookingsController,
  BarberSettingsController,
} from './barbers.controller';
import { BarbersService } from './barbers.service';
import { BarberServicesController } from './services/barber-services.controller';
import { BarberServicesService } from './services/barber-services.service';
import { BookingsModule } from '../bookings/bookings.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [BookingsModule, PaymentsModule],
  controllers: [
    BarbersController,
    BarberBookingsController,
    BarberSettingsController,
    BarberServicesController,
  ],
  providers: [BarbersService, BarberServicesService],
  exports: [BarberServicesService],
})
export class BarbersModule {}
