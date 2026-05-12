import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ClientBarbersController } from './clients.controller';
import { ClientProfileController } from './client-profile.controller';
import { ClientsService } from './clients.service';
import { NoShowsModule } from '../no-shows/no-shows.module';

@Module({
  imports: [
    NoShowsModule,
    MulterModule.register({
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  ],
  controllers: [ClientBarbersController, ClientProfileController],
  providers: [ClientsService],
})
export class ClientsModule {}
