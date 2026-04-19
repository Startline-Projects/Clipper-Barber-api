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

export class BarberBookingListItemDto {
  @ApiProperty() id: string;
  @ApiProperty({ type: BarberBookingClientSummaryDto }) client: BarberBookingClientSummaryDto;
  @ApiProperty({ type: BarberBookingServiceSummaryDto }) service: BarberBookingServiceSummaryDto;
  @ApiProperty() scheduledAt: string;
  @ApiProperty({ enum: BookingTypeDto }) bookingType: BookingTypeDto;
  @ApiProperty() totalPrice: number;
  @ApiProperty({ enum: BookingStatusDto }) status: BookingStatusDto;
  @ApiProperty() isRecurring: boolean;
  @ApiProperty() createdAt: string;
}

export class BarberBookingsListResponseDto {
  @ApiProperty({ type: [BarberBookingListItemDto] })
  bookings: BarberBookingListItemDto[];

  @ApiProperty({ nullable: true, type: String }) nextCursor: string | null;
  @ApiProperty() hasMore: boolean;
}
