import { ApiProperty } from '@nestjs/swagger';
import {
  BookingBarberSummaryDto,
  BookingPricingDto,
  BookingServiceSummaryDto,
} from './preview-booking-response.dto';

export class ConfirmedBookingDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'pending' }) status: string;
  @ApiProperty({ example: '2026-05-12T00:30:00.000Z', description: 'UTC instant (ISO 8601)' })
  scheduledAt: string;
  @ApiProperty({ example: 'America/New_York', description: 'Barber IANA timezone' })
  timezone: string;
  @ApiProperty({ example: '2026-05-11', description: 'Local calendar date in `timezone` (YYYY-MM-DD)' })
  appointmentDate: string;
  @ApiProperty({ example: '20:30', description: 'Local wall-clock in `timezone` (HH:MM)' })
  appointmentTime: string;
  @ApiProperty() totalDurationMinutes: number;
  @ApiProperty({ type: [BookingServiceSummaryDto] }) services: BookingServiceSummaryDto[];
  @ApiProperty({ type: BookingPricingDto }) pricing: BookingPricingDto;
  @ApiProperty({ type: BookingBarberSummaryDto }) barber: BookingBarberSummaryDto;
  @ApiProperty({ nullable: true, type: String }) confirmedAt: string | null;
}

export class ConfirmBookingResponseDto {
  @ApiProperty({ type: ConfirmedBookingDto }) booking: ConfirmedBookingDto;
}
