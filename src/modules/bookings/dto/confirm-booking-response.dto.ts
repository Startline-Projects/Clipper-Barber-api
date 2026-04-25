import { ApiProperty } from '@nestjs/swagger';
import {
  BookingBarberSummaryDto,
  BookingPricingDto,
  BookingServiceSummaryDto,
} from './preview-booking-response.dto';

export class ConfirmedBookingDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'pending' }) status: string;
  @ApiProperty() scheduledAt: string;
  @ApiProperty() totalDurationMinutes: number;
  @ApiProperty({ type: [BookingServiceSummaryDto] }) services: BookingServiceSummaryDto[];
  @ApiProperty({ type: BookingPricingDto }) pricing: BookingPricingDto;
  @ApiProperty({ type: BookingBarberSummaryDto }) barber: BookingBarberSummaryDto;
  @ApiProperty({ nullable: true, type: String }) confirmedAt: string | null;
}

export class ConfirmBookingResponseDto {
  @ApiProperty({ type: ConfirmedBookingDto }) booking: ConfirmedBookingDto;
}
