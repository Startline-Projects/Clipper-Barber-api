import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatusDto } from '../../barbers/dto/list-barber-bookings-query.dto';

export class ClientNextBookingDto {
  @ApiProperty() id: string;
  @ApiProperty() barberId: string;
  @ApiProperty() barberName: string;
  @ApiProperty({ nullable: true, type: String }) barberProfileImage: string | null;
  @ApiProperty() serviceName: string;
  @ApiProperty({ description: 'UTC ISO timestamp' }) scheduledAt: string;
  @ApiProperty({ example: '2026-05-01', description: 'Local calendar date (YYYY-MM-DD)' })
  appointmentDate: string;
  @ApiProperty({ example: '10:30', description: 'Local time (HH:MM)' })
  appointmentTime: string;
  @ApiProperty({ example: 30 }) durationMinutes: number;
  @ApiProperty({ enum: BookingStatusDto }) status: BookingStatusDto;
  @ApiProperty() isRecurring: boolean;
  @ApiProperty({ nullable: true, type: String }) recurringBookingId: string | null;
}

export class ClientProfileResponseDto {
  @ApiProperty({ description: 'Canonical user id — same value as auth.users.id' })
  id: string;

  @ApiProperty() name: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  username?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  profilePhotoUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  email?: string | null;

  @ApiProperty({ description: 'Subscription state from Stripe' })
  subscriptionStatus: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  subscriptionExpiresAt?: string | null;

  @ApiProperty({ description: 'ISO timestamp of account creation' })
  createdAt: string;

  @ApiProperty({
    type: ClientNextBookingDto,
    nullable: true,
    description:
      'The next upcoming booking (recurring or one-off), null when the client has no upcoming bookings.',
  })
  nextUpcomingBooking: ClientNextBookingDto | null;
}
