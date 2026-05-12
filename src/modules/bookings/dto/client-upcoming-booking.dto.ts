import { ApiProperty } from '@nestjs/swagger';
import { BookingStatusDto } from '../../barbers/dto/list-barber-bookings-query.dto';
import { BookingsPageMetaDto } from '../../clients/dto/pagination.dto';
import { BookingTypeDto } from './preview-booking.dto';

export class ClientUpcomingBookingServiceDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ example: 30 }) durationMinutes: number;
  @ApiProperty({ enum: BookingTypeDto }) bookingType: BookingTypeDto;
  @ApiProperty({ example: 0 }) startOffsetMinutes: number;
}

export class ClientUpcomingBookingDto {
  @ApiProperty() id: string;
  @ApiProperty() barberName: string;
  @ApiProperty({ nullable: true, type: String }) barberProfileImage: string | null;
  // Legacy single-service label — for older clients. Multi-service bookings
  // surface a joined display (e.g. "Haircut + Beard"). The full breakdown
  // is in `services` below.
  @ApiProperty() serviceName: string;
  @ApiProperty({ type: [ClientUpcomingBookingServiceDto] })
  services: ClientUpcomingBookingServiceDto[];
  @ApiProperty({ example: '2026-05-12T00:30:00.000Z', description: 'UTC instant (ISO 8601)' })
  scheduledAt: string;
  @ApiProperty({ example: 'America/New_York', description: 'Barber IANA timezone' })
  timezone: string;
  @ApiProperty({ example: '2026-05-01', description: 'Local calendar date in `timezone` (YYYY-MM-DD)' })
  appointmentDate: string;
  @ApiProperty({ example: '10:30', description: 'Local wall-clock in `timezone` (HH:MM)' })
  appointmentTime: string;
  // Total block duration — the calendar should render ONE continuous slot of
  // this length, not one slot per service.
  @ApiProperty({ example: 60 }) durationMinutes: number;
  @ApiProperty({ example: 60 }) totalDurationMinutes: number;
  @ApiProperty({ enum: BookingStatusDto }) status: BookingStatusDto;
  @ApiProperty() isRecurring: boolean;
}

export class ClientUpcomingBookingsResponseDto {
  @ApiProperty({ type: [ClientUpcomingBookingDto] })
  bookings: ClientUpcomingBookingDto[];

  @ApiProperty({ type: BookingsPageMetaDto })
  pagination: BookingsPageMetaDto;

  @ApiProperty({
    example: false,
    description:
      "True when the authenticated client's clients.subscription_status === 'active'.",
  })
  hasActivePlan: boolean;
}
