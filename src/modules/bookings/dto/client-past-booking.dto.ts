import { ApiProperty } from '@nestjs/swagger';
import { BookingsPageMetaDto } from '../../clients/dto/pagination.dto';
import { BookingStatusDto } from '../../barbers/dto/list-barber-bookings-query.dto';

export class ClientPastBookingDto {
  @ApiProperty() id: string;
  @ApiProperty() barberName: string;
  @ApiProperty({ nullable: true, type: String }) barberProfileImage: string | null;
  @ApiProperty() serviceName: string;
  @ApiProperty({ example: '2026-03-14T15:30:00.000Z', description: 'UTC instant (ISO 8601)' })
  scheduledAt: string;
  @ApiProperty({ example: 'America/New_York', description: 'Barber IANA timezone' })
  timezone: string;
  @ApiProperty({ example: '2026-03-14', description: 'Local calendar date in `timezone` (YYYY-MM-DD)' })
  appointmentDate: string;
  @ApiProperty({ example: '10:30', description: 'Local wall-clock in `timezone` (HH:MM)' })
  appointmentTime: string;
  @ApiProperty({
    example: 60,
    description: 'Total block duration in minutes (slot count × slot duration)',
  })
  totalDurationMinutes: number;
  @ApiProperty({ example: 45.0 }) pricePaid: number;
  @ApiProperty({ enum: BookingStatusDto }) status: BookingStatusDto;
  @ApiProperty() hasReview: boolean;
}

export class ClientPastBookingsResponseDto {
  @ApiProperty({ type: [ClientPastBookingDto] })
  bookings: ClientPastBookingDto[];

  @ApiProperty({ type: BookingsPageMetaDto })
  pagination: BookingsPageMetaDto;
}
