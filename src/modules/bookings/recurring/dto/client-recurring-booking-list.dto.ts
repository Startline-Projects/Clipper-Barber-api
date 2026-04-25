import { ApiProperty } from '@nestjs/swagger';
import { BookingStatusDto } from '../../../barbers/dto/list-barber-bookings-query.dto';
import { BookingsPageMetaDto } from '../../../clients/dto/pagination.dto';

export enum ClientRecurringStatusDto {
  ACTIVE = 'active',
  PAUSED = 'paused',
  PENDING_APPROVAL = 'pending_approval',
}

export class ClientRecurringBookingListItemDto {
  @ApiProperty() id: string;
  @ApiProperty() barberName: string;
  @ApiProperty({ nullable: true, type: String }) barberProfileImage: string | null;
  @ApiProperty() serviceName: string;
  @ApiProperty({ nullable: true, type: String, example: '2026-05-01' })
  nextAppointmentDate: string | null;
  @ApiProperty({ nullable: true, type: String, example: '10:30' })
  appointmentTime: string | null;
  @ApiProperty() durationMinutes: number;
  @ApiProperty({ enum: BookingStatusDto, nullable: true })
  bookingStatus: BookingStatusDto | null;
  @ApiProperty({ enum: ClientRecurringStatusDto })
  recurringStatus: ClientRecurringStatusDto;
  @ApiProperty({ example: 8, description: 'Scheduled upcoming appointments remaining' })
  appointmentsLeft: number;
}

export class ClientRecurringBookingsListResponseDto {
  @ApiProperty({ type: [ClientRecurringBookingListItemDto] })
  bookings: ClientRecurringBookingListItemDto[];

  @ApiProperty({ type: BookingsPageMetaDto })
  pagination: BookingsPageMetaDto;
}
