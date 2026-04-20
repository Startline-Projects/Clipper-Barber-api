import { Module } from '@nestjs/common';
import { BookingsController, ClientBookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { AvailabilityService } from './availability.service';
import { BookingCompletionService } from './booking-completion.service';
import { BookingCompletionCron } from './booking-completion.cron';
import {
  BarberRecurringBookingsController,
  ClientRecurringBookingsController,
  ClientRecurringSlotsController,
} from './recurring/recurring.controller';
import { RecurringBookingsService } from './recurring/recurring.service';
import { RecurringBookingGeneratorService } from './recurring/recurring-booking-generator.service';
import { RecurringBookingsCron } from './recurring/recurring.cron';

@Module({
  controllers: [
    BookingsController,
    ClientBookingsController,
    ClientRecurringBookingsController,
    ClientRecurringSlotsController,
    BarberRecurringBookingsController,
  ],
  providers: [
    BookingsService,
    AvailabilityService,
    BookingCompletionService,
    BookingCompletionCron,
    RecurringBookingsService,
    RecurringBookingGeneratorService,
    RecurringBookingsCron,
  ],
  exports: [
    AvailabilityService,
    BookingsService,
    BookingCompletionService,
    RecurringBookingsService,
    RecurringBookingGeneratorService,
  ],
})
export class BookingsModule {}
