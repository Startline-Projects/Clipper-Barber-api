import { Module } from '@nestjs/common';
import { BookingsController, ClientBookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { AvailabilityService } from './availability.service';
import { BookingCompletionService } from './booking-completion.service';
import { BookingCompletionCron } from './booking-completion.cron';
import {
  BarberRecurringBookingsController,
  BarberRecurringSlotsController,
  ClientRecurringBookingsController,
  ClientRecurringSlotsController,
} from './recurring/recurring.controller';
import { RecurringBookingsService } from './recurring/recurring.service';
import { RecurringBookingGeneratorService } from './recurring/recurring-booking-generator.service';
import { RecurringBookingsCron } from './recurring/recurring.cron';
import {
  BarberRecurringArrangementsController,
  ClientRecurringArrangementsController,
} from './recurring/recurring-arrangements.controller';
import { RecurringArrangementsService } from './recurring/recurring-arrangements.service';
import { RecurringArrangementsCron } from './recurring/recurring-arrangements.cron';
import { MessagesModule } from '../messages/messages.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [MessagesModule, PaymentsModule],
  controllers: [
    BookingsController,
    ClientBookingsController,
    ClientRecurringBookingsController,
    ClientRecurringSlotsController,
    BarberRecurringBookingsController,
    BarberRecurringSlotsController,
    BarberRecurringArrangementsController,
    ClientRecurringArrangementsController,
  ],
  providers: [
    BookingsService,
    AvailabilityService,
    BookingCompletionService,
    BookingCompletionCron,
    RecurringBookingsService,
    RecurringBookingGeneratorService,
    RecurringBookingsCron,
    RecurringArrangementsService,
    RecurringArrangementsCron,
  ],
  exports: [
    AvailabilityService,
    BookingsService,
    BookingCompletionService,
    RecurringBookingsService,
    RecurringBookingGeneratorService,
    RecurringArrangementsService,
  ],
})
export class BookingsModule {}
