import { ApiProperty } from '@nestjs/swagger';
import { BookingTypeDto } from '../../bookings/dto/preview-booking.dto';
import { BookingStatusDto } from './list-barber-bookings-query.dto';

export class BarberBookingClientSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) profilePhotoUrl: string | null;
}

export class BarberBookingServiceSummaryDto {
  @ApiProperty() name: string;
  @ApiProperty() durationMinutes: number;
}

export class BarberBookingServiceItemDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ example: 30, description: "Service's nominal duration (from barber_services)" })
  durationMinutes: number;
  @ApiProperty({ enum: BookingTypeDto }) bookingType: BookingTypeDto;
  @ApiProperty({ example: 0, description: 'Minutes from block start when this service begins' })
  startOffsetMinutes: number;
}

export class BarberBookingListItemDto {
  @ApiProperty() id: string;
  @ApiProperty({ type: BarberBookingClientSummaryDto }) client: BarberBookingClientSummaryDto;
  // Legacy single-service summary (kept for older clients). `durationMinutes`
  // here is the TOTAL block duration so old UIs still render the correct
  // visual height — the `name` is the primary service.
  @ApiProperty({ type: BarberBookingServiceSummaryDto }) service: BarberBookingServiceSummaryDto;
  @ApiProperty({ type: [BarberBookingServiceItemDto] }) services: BarberBookingServiceItemDto[];
  @ApiProperty({ example: 60, description: 'Combined block duration across all services' })
  totalDurationMinutes: number;
  @ApiProperty({ example: '2026-05-12T00:30:00.000Z', description: 'UTC instant (ISO 8601)' })
  scheduledAt: string;
  @ApiProperty({ example: 'America/New_York', description: 'Barber IANA timezone' })
  timezone: string;
  @ApiProperty({ example: '2026-05-11', description: 'Local calendar date in `timezone` (YYYY-MM-DD)' })
  appointmentDate: string;
  @ApiProperty({ example: '20:30', description: 'Local wall-clock in `timezone` (HH:MM)' })
  appointmentTime: string;
  @ApiProperty({ enum: BookingTypeDto }) bookingType: BookingTypeDto;
  @ApiProperty() totalPrice: number;
  @ApiProperty({ enum: BookingStatusDto }) status: BookingStatusDto;
  @ApiProperty() isRecurring: boolean;
  @ApiProperty({ nullable: true, type: String }) recurringBookingId: string | null;
  @ApiProperty() createdAt: string;
}

export class BarberBookingsListResponseDto {
  @ApiProperty({ type: [BarberBookingListItemDto] })
  bookings: BarberBookingListItemDto[];

  @ApiProperty({ nullable: true, type: String }) nextCursor: string | null;
  @ApiProperty() hasMore: boolean;
}
