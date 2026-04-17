import { Module } from '@nestjs/common';
import { BookingsController, ClientBookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { AvailabilityService } from './availability.service';
import { BookingCompletionService } from './booking-completion.service';
import { BookingCompletionCron } from './booking-completion.cron';

@Module({
  controllers: [BookingsController, ClientBookingsController],
  providers: [BookingsService, AvailabilityService, BookingCompletionService, BookingCompletionCron],
  exports: [AvailabilityService, BookingsService, BookingCompletionService],
})
export class BookingsModule {}
