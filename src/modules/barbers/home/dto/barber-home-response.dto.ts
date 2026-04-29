import { ApiProperty } from '@nestjs/swagger';
import { BookingStatusDto } from '../../dto/list-barber-bookings-query.dto';

export class BarberHomeClientDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Ahmed Mostafa' }) fullName: string;
  @ApiProperty({ nullable: true, type: String }) profilePhotoUrl: string | null;
}

export class BarberHomeServiceDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Fade + Beard' }) name: string;
}

export class BarberHomeScheduleServiceDto extends BarberHomeServiceDto {
  @ApiProperty({ example: 30 }) durationMinutes: number;
}

export class BarberHomeTodayDto {
  @ApiProperty({ example: '2026-04-29', description: 'Calendar date in the resolved timezone' })
  date: string;

  @ApiProperty({ example: 'Africa/Cairo' })
  timezone: string;

  @ApiProperty({ example: 8, description: 'Bookings starting today excluding cancelled' })
  totalAppointments: number;

  @ApiProperty({ example: 3 })
  completedCount: number;

  @ApiProperty({
    example: 5,
    description:
      'Today bookings still ahead or in progress (status confirmed or pending, end > now)',
  })
  remainingCount: number;

  @ApiProperty({
    example: 1200,
    description: 'Sum of price_usd for completed bookings starting today',
  })
  earningsSoFarUsd: number;
}

export class BarberHomePendingItemDto {
  @ApiProperty({ format: 'uuid' }) bookingId: string;
  @ApiProperty({ type: BarberHomeClientDto }) client: BarberHomeClientDto;
  @ApiProperty({ type: BarberHomeServiceDto, nullable: true })
  service: BarberHomeServiceDto | null;
  @ApiProperty() scheduledAt: string;
  @ApiProperty({ example: 400 }) priceUsd: number;
  @ApiProperty({ enum: BookingStatusDto, example: BookingStatusDto.PENDING })
  status: BookingStatusDto;
  @ApiProperty() requestedAt: string;
}

export class BarberHomePendingDto {
  @ApiProperty({ example: 7, description: 'Full count, not capped at items.length' })
  totalCount: number;

  @ApiProperty({ type: [BarberHomePendingItemDto] })
  items: BarberHomePendingItemDto[];
}

export class BarberHomeScheduleItemDto {
  @ApiProperty({ format: 'uuid' }) bookingId: string;
  @ApiProperty({ type: BarberHomeClientDto }) client: BarberHomeClientDto;
  @ApiProperty({ type: BarberHomeScheduleServiceDto, nullable: true })
  service: BarberHomeScheduleServiceDto | null;
  @ApiProperty() scheduledAt: string;
  @ApiProperty() endAt: string;

  @ApiProperty({
    example: 45,
    description:
      'Whole minutes from server now() until scheduledAt. Re-derive client-side from scheduledAt for live ticking.',
  })
  minutesUntilStart: number;

  @ApiProperty({ example: 400 }) priceUsd: number;
  @ApiProperty({ enum: BookingStatusDto, example: BookingStatusDto.CONFIRMED })
  status: BookingStatusDto;
}

export class BarberHomeScheduleDto {
  @ApiProperty({ example: 5, description: 'Full count of confirmed bookings remaining today' })
  totalUpcomingToday: number;

  @ApiProperty({ type: [BarberHomeScheduleItemDto] })
  items: BarberHomeScheduleItemDto[];
}

export class BarberHomeResponseDto {
  @ApiProperty({ type: BarberHomeTodayDto }) today: BarberHomeTodayDto;
  @ApiProperty({ type: BarberHomePendingDto }) pendingApproval: BarberHomePendingDto;
  @ApiProperty({ type: BarberHomeScheduleDto }) schedule: BarberHomeScheduleDto;
}
