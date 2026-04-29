import { ApiProperty } from '@nestjs/swagger';
import { BookingStatusDto } from '../../dto/list-barber-bookings-query.dto';
import { BookingTypeDto } from '../../../bookings/dto/preview-booking.dto';

export class BarberClientDetailProfileDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Ahmed Mostafa' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  profilePhotoUrl: string | null;

  @ApiProperty({ nullable: true, type: String })
  email: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'Auth account creation timestamp' })
  createdAt: string | null;

  @ApiProperty({
    description: 'Always false — guest/walk-in bookings are not supported by the schema',
  })
  isGuest: boolean;
}

export class BarberClientFavouriteServiceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Skin Fade' })
  name: string;
}

export class BarberClientStatsDto {
  @ApiProperty({ example: 12 })
  totalVisits: number;

  @ApiProperty({ example: 480 })
  totalSpendUsd: number;

  @ApiProperty({
    example: 40,
    description: 'totalSpendUsd / totalVisits (0 when totalVisits is 0)',
  })
  averageSpendUsd: number;

  @ApiProperty({ nullable: true, type: String })
  firstVisitAt: string | null;

  @ApiProperty({ nullable: true, type: String })
  lastVisitAt: string | null;

  @ApiProperty({ example: 1 })
  noShowCount: number;

  @ApiProperty({ example: 2 })
  cancellationCount: number;

  @ApiProperty({ nullable: true, type: BarberClientFavouriteServiceDto })
  favouriteService: BarberClientFavouriteServiceDto | null;
}

export class BarberClientBookingServiceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  durationMinutes: number;

  @ApiProperty({ enum: BookingTypeDto })
  bookingType: BookingTypeDto;

  @ApiProperty({ example: 25 })
  priceUsd: number;
}

export class BarberClientBookingDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: BookingStatusDto })
  status: BookingStatusDto;

  @ApiProperty({ description: 'ISO timestamp — block start' })
  scheduledAt: string;

  @ApiProperty({ description: 'Total block duration including all services' })
  totalDurationMinutes: number;

  @ApiProperty({ enum: BookingTypeDto, description: 'Type of the primary (first) service' })
  bookingType: BookingTypeDto;

  @ApiProperty({ type: [BarberClientBookingServiceDto] })
  services: BarberClientBookingServiceDto[];

  @ApiProperty({ example: 80 })
  totalPriceUsd: number;

  @ApiProperty()
  isRecurring: boolean;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  recurringBookingId: string | null;

  @ApiProperty({ nullable: true, type: String })
  cancelledAt: string | null;

  @ApiProperty({ nullable: true, enum: ['client', 'barber'] })
  cancelledBy: 'client' | 'barber' | null;
}

export class BarberClientPastBookingsPageMetaDto {
  @ApiProperty() currentPage: number;
  @ApiProperty() totalPages: number;
  @ApiProperty() limit: number;
  @ApiProperty() hasNextPage: boolean;
  @ApiProperty() totalBookings: number;
}

export class BarberClientPastBookingsDto {
  @ApiProperty({ type: [BarberClientBookingDto] })
  items: BarberClientBookingDto[];

  @ApiProperty({ type: BarberClientPastBookingsPageMetaDto })
  pagination: BarberClientPastBookingsPageMetaDto;
}

export class BarberClientRecurringSeriesDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 2, description: '0 = Sunday … 6 = Saturday' })
  dayOfWeek: number;

  @ApiProperty({ example: '14:00' })
  slotTime: string;

  @ApiProperty({ enum: ['weekly', 'biweekly'] })
  frequency: 'weekly' | 'biweekly';

  @ApiProperty({
    enum: ['pending_barber_approval', 'active', 'paused', 'cancelled', 'expired'],
  })
  status: 'pending_barber_approval' | 'active' | 'paused' | 'cancelled' | 'expired';

  @ApiProperty()
  active: boolean;

  @ApiProperty({ example: 80 })
  priceUsd: number;

  @ApiProperty({ type: BarberClientFavouriteServiceDto })
  service: BarberClientFavouriteServiceDto;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Next pending/confirmed materialised occurrence',
  })
  nextOccurrenceAt: string | null;

  @ApiProperty()
  startedAt: string;

  @ApiProperty({ nullable: true, type: String })
  cancelledAt: string | null;
}

export class BarberClientDetailDto {
  @ApiProperty({ type: BarberClientDetailProfileDto })
  client: BarberClientDetailProfileDto;

  @ApiProperty({ type: BarberClientStatsDto })
  stats: BarberClientStatsDto;

  @ApiProperty({
    type: [BarberClientBookingDto],
    description: 'Future scheduled bookings, sorted ascending by start',
  })
  upcomingBookings: BarberClientBookingDto[];

  @ApiProperty({ type: BarberClientPastBookingsDto })
  pastBookings: BarberClientPastBookingsDto;

  @ApiProperty({ type: [BarberClientRecurringSeriesDto] })
  recurringSeries: BarberClientRecurringSeriesDto[];
}
