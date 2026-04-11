import { Module } from '@nestjs/common';
import { BarbersController } from './barbers.controller';
import { BarbersService } from './barbers.service';
import { BarberServicesController } from './services/barber-services.controller';
import { BarberServicesService } from './services/barber-services.service';

@Module({
  controllers: [BarbersController, BarberServicesController],
  providers: [BarbersService, BarberServicesService],
  exports: [BarberServicesService],
})
export class BarbersModule {}
