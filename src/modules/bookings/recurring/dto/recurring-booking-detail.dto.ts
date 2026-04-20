import { ApiProperty } from '@nestjs/swagger';
import { RecurringBookingDto } from './recurring-booking.dto';

export class RecurringOccurrenceDto {
  @ApiProperty() bookingId: string;
  @ApiProperty() scheduledAt: string;
  @ApiProperty() status: string;
}

export class RecurringBookingDetailDto extends RecurringBookingDto {
  @ApiProperty({ type: [RecurringOccurrenceDto] })
  pastOccurrences: RecurringOccurrenceDto[];

  @ApiProperty({ type: [RecurringOccurrenceDto], description: 'Hard cap of 8' })
  upcomingOccurrences: RecurringOccurrenceDto[];
}

export class RecurringBookingDetailResponseDto {
  @ApiProperty({ type: RecurringBookingDetailDto })
  recurringBooking: RecurringBookingDetailDto;
}
