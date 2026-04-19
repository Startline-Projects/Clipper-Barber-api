import { ApiProperty } from '@nestjs/swagger';
import { BookingTypeDto } from './preview-booking.dto';
import { BookingStatusDto } from '../../barbers/dto/list-barber-bookings-query.dto';

export class ClientBookingBarberSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) profilePhotoUrl: string | null;
}

export class ClientBookingServiceSummaryDto {
  @ApiProperty() name: string;
  @ApiProperty() durationMinutes: number;
}

export class ClientBookingListItemDto {
  @ApiProperty() id: string;
  @ApiProperty({ type: ClientBookingBarberSummaryDto }) barber: ClientBookingBarberSummaryDto;
  @ApiProperty({ type: ClientBookingServiceSummaryDto }) service: ClientBookingServiceSummaryDto;
  @ApiProperty() scheduledAt: string;
  @ApiProperty({ enum: BookingTypeDto }) bookingType: BookingTypeDto;
  @ApiProperty() totalPrice: number;
  @ApiProperty({ enum: BookingStatusDto }) status: BookingStatusDto;
  @ApiProperty({ nullable: true, type: String }) cancelledAt: string | null;
  @ApiProperty({ nullable: true, enum: ['client', 'barber'] }) cancelledBy: 'client' | 'barber' | null;
  @ApiProperty() noShowCharged: boolean;
  @ApiProperty({ nullable: true, type: Number }) noShowChargeAmountUsd: number | null;
  // TODO: surface isRecurring once recurring bookings ship end-to-end on the client side.
}

export class ClientBookingsListResponseDto {
  @ApiProperty({ type: [ClientBookingListItemDto] })
  bookings: ClientBookingListItemDto[];

  @ApiProperty({ nullable: true, type: String }) nextCursor: string | null;
  @ApiProperty() hasMore: boolean;
}
