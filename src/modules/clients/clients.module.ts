import { Module } from '@nestjs/common';
import { ClientBarbersController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  controllers: [ClientBarbersController],
  providers: [ClientsService],
})
export class ClientsModule {}
