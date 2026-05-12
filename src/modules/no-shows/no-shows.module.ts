import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { PaymentsModule } from '../payments/payments.module';
import { NoShowsService } from './no-shows.service';
import {
  BarberNoShowsController,
  ClientNoShowsController,
} from './no-shows.controller';

@Module({
  imports: [SupabaseModule, PaymentsModule],
  controllers: [ClientNoShowsController, BarberNoShowsController],
  providers: [NoShowsService],
  exports: [NoShowsService],
})
export class NoShowsModule {}
