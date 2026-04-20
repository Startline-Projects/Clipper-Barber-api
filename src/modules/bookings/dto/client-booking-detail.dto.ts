import { ApiProperty } from '@nestjs/swagger';
import { BookingTypeDto } from './preview-booking.dto';
import { BookingStatusDto } from '../../barbers/dto/list-barber-bookings-query.dto';
import {
  ClientBookingBarberSummaryDto,
  ClientBookingServiceSummaryDto,
} from './client-booking-list-item.dto';

export class ClientBookingDetailPricingDto {
  @ApiProperty() basePrice: number;
  @ApiProperty() additionalCost: number;
  @ApiProperty() totalPrice: number;
}

export class ClientBookingReviewDto {
  @ApiProperty() id: string;
  @ApiProperty() rating: number;
  @ApiProperty({ nullable: true, type: String }) comment: string | null;
  @ApiProperty() createdAt: string;
}

export class ClientBookingDetailDto {
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
  @ApiProperty({ type: ClientBookingDetailPricingDto }) pricing: ClientBookingDetailPricingDto;
  @ApiProperty({ nullable: true, type: String }) confirmedAt: string | null;
  @ApiProperty({ nullable: true, type: ClientBookingReviewDto }) review: ClientBookingReviewDto | null;
  @ApiProperty() isRecurring: boolean;
  @ApiProperty({ nullable: true, type: String }) recurringBookingId: string | null;
}

export class ClientBookingDetailResponseDto {
  @ApiProperty({ type: ClientBookingDetailDto }) booking: ClientBookingDetailDto;
}
