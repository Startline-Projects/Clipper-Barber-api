import { ApiProperty } from '@nestjs/swagger';
import { BookingStatusDto } from '../../barbers/dto/list-barber-bookings-query.dto';
import { BookingsPageMetaDto } from '../../clients/dto/pagination.dto';

export class ClientUpcomingBookingDto {
  @ApiProperty() id: string;
  @ApiProperty() barberName: string;
  @ApiProperty({ nullable: true, type: String }) barberProfileImage: string | null;
  @ApiProperty() serviceName: string;
  @ApiProperty({ example: '2026-05-01', description: 'Local calendar date (YYYY-MM-DD)' })
  appointmentDate: string;
  @ApiProperty({ example: '10:30', description: 'Local time (HH:MM)' })
  appointmentTime: string;
  @ApiProperty({ example: 30 }) durationMinutes: number;
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
