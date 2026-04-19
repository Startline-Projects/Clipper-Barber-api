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

@Module({
  imports: [BookingsModule],
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
