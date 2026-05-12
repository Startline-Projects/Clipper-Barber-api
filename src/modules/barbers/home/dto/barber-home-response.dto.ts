import { ApiProperty } from '@nestjs/swagger';
import { BookingStatusDto } from '../../dto/list-barber-bookings-query.dto';
import { BookingTypeDto } from '../../../bookings/dto/preview-booking.dto';

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
  @ApiProperty({
    example: 60,
    description: 'Total block duration of the booking (NOT this service\'s nominal duration).',
  })
  durationMinutes: number;
}

export class BarberHomeBookingServiceItemDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ example: 30 }) durationMinutes: number;
  @ApiProperty({ enum: BookingTypeDto }) bookingType: BookingTypeDto;
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
  @ApiProperty({ type: [BarberHomeBookingServiceItemDto] })
  services: BarberHomeBookingServiceItemDto[];
  @ApiProperty({ example: '2026-05-12T00:30:00.000Z', description: 'UTC instant (ISO 8601)' })
  scheduledAt: string;
  @ApiProperty({ example: 'America/New_York', description: 'Barber IANA timezone' })
  timezone: string;
  @ApiProperty({ example: '2026-05-11', description: 'Local calendar date in `timezone` (YYYY-MM-DD)' })
  appointmentDate: string;
  @ApiProperty({ example: '20:30', description: 'Local wall-clock in `timezone` (HH:MM)' })
  appointmentTime: string;
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
  @ApiProperty({ type: [BarberHomeBookingServiceItemDto] })
  services: BarberHomeBookingServiceItemDto[];
  @ApiProperty({ example: 60 }) totalDurationMinutes: number;
  @ApiProperty({ example: '2026-05-12T00:30:00.000Z', description: 'UTC instant (ISO 8601)' })
  scheduledAt: string;
  @ApiProperty({ example: 'America/New_York', description: 'Barber IANA timezone' })
  timezone: string;
  @ApiProperty({ example: '2026-05-11', description: 'Local calendar date in `timezone` (YYYY-MM-DD)' })
  appointmentDate: string;
  @ApiProperty({ example: '20:30', description: 'Local wall-clock in `timezone` (HH:MM)' })
  appointmentTime: string;
  @ApiProperty({ example: '2026-05-12T01:30:00.000Z', description: 'UTC end instant (ISO 8601)' })
  endAt: string;

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

  @ApiProperty() allowAutoConfirm: boolean;
  @ApiProperty() autoConfirmToday: boolean;
  @ApiProperty() recurringEnabled: boolean;
  @ApiProperty() noShowChargeEnabled: boolean;
  @ApiProperty({ nullable: true, type: Number }) noShowChargeAmountUsd: number | null;

  @ApiProperty({ description: 'True when the barber has a Stripe Connect account on file' })
  stripeConnected: boolean;

  @ApiProperty({ description: 'True when both latitude and longitude are set on the profile' })
  locationSet: boolean;
}
