import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type RecurringBookingStatus =
  | 'pending_barber_approval'
  | 'active'
  | 'paused'
  | 'cancelled'
  | 'expired';

export class RecurringBookingServiceLiteDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() durationMinutes: number;
}

export class RecurringBookingServiceDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() durationMinutes: number;
  @ApiProperty({ example: 'regular', enum: ['regular', 'after_hours', 'day_off'] })
  bookingType: 'regular' | 'after_hours' | 'day_off';
  @ApiProperty() startOffsetMinutes: number;
  @ApiProperty() priceUsd: number;
}

export class RecurringBookingPartyDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

export class RecurringBookingDto {
  @ApiProperty() id: string;
  @ApiProperty({
    example: 'pending_barber_approval',
    description: 'pending_barber_approval | active | paused | cancelled | expired',
  })
  status: RecurringBookingStatus;

  @ApiProperty() isRenewal: boolean;
  @ApiPropertyOptional({ nullable: true }) originalRecurringBookingId: string | null;

  @ApiProperty({ example: 2, description: '0 = Sunday, 6 = Saturday' })
  dayOfWeek: number;

  @ApiProperty({ example: '09:00' })
  slotTime: string;

  @ApiProperty({ example: 'weekly' })
  frequency: 'weekly' | 'biweekly';

  @ApiProperty({ example: 55.0 })
  priceUsd: number;

  @ApiPropertyOptional({ nullable: true }) pauseStartDate: string | null;
  @ApiPropertyOptional({ nullable: true }) pauseEndDate: string | null;
  @ApiPropertyOptional({ nullable: true }) windowStartDate: string | null;

  @ApiProperty({ type: RecurringBookingServiceLiteDto })
  service: RecurringBookingServiceLiteDto;

  @ApiProperty({ type: [RecurringBookingServiceDto] })
  services: RecurringBookingServiceDto[];

  @ApiProperty({ example: 60, description: 'Summed duration across all services.' })
  totalDurationMinutes: number;

  @ApiProperty({ type: RecurringBookingPartyDto })
  barber: RecurringBookingPartyDto;

  @ApiPropertyOptional({ nullable: true, description: "Barber's profile photo URL (raw public URL from barbers.profile_photo_url)." })
  barberProfilePhotoUrl: string | null;

  @ApiProperty({ type: RecurringBookingPartyDto })
  client: RecurringBookingPartyDto;

  @ApiPropertyOptional({ nullable: true, description: "Client's profile photo URL (raw public URL from clients.profile_photo_url)." })
  clientProfilePhotoUrl: string | null;

  @ApiProperty() createdAt: string;

  @ApiPropertyOptional({ nullable: true }) barberAcceptedAt: string | null;
  @ApiPropertyOptional({ nullable: true }) barberDeclinedAt: string | null;
  @ApiPropertyOptional({ nullable: true }) declinedReason: string | null;

  @ApiPropertyOptional({ nullable: true }) cancelledAt: string | null;
  @ApiPropertyOptional({ nullable: true }) cancelledBy: 'client' | 'barber' | null;
}

export class RecurringBookingResponseDto {
  @ApiProperty({ type: RecurringBookingDto })
  recurringBooking: RecurringBookingDto;
}
