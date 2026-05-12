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
import { BarberClientsController } from './clients/barber-clients.controller';
import { BarberClientsService } from './clients/barber-clients.service';
import { BarberHomeController } from './home/barber-home.controller';
import { BarberHomeService } from './home/barber-home.service';
import { BookingsModule } from '../bookings/bookings.module';
import { PaymentsModule } from '../payments/payments.module';
import { NoShowsModule } from '../no-shows/no-shows.module';

@Module({
  imports: [
    BookingsModule,
    PaymentsModule,
    NoShowsModule,
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
    BarberClientsController,
    BarberHomeController,
  ],
  providers: [BarbersService, BarberServicesService, BarberClientsService, BarberHomeService],
  exports: [BarberServicesService],
})
export class BarbersModule {}
