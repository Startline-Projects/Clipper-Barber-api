import { ApiProperty } from '@nestjs/swagger';
import { BookingTypeDto } from '../../bookings/dto/preview-booking.dto';
import { BookingStatusDto } from './list-barber-bookings-query.dto';
import {
  BarberBookingClientSummaryDto,
  BarberBookingServiceSummaryDto,
} from './barber-booking-list-item.dto';

export class BarberBookingDetailPricingDto {
  @ApiProperty() basePrice: number;
  @ApiProperty() additionalCost: number;
  @ApiProperty() totalPrice: number;
}

export class BarberBookingDetailDto {
  @ApiProperty() id: string;
  @ApiProperty({ type: BarberBookingClientSummaryDto }) client: BarberBookingClientSummaryDto;
  @ApiProperty({ type: BarberBookingServiceSummaryDto }) service: BarberBookingServiceSummaryDto;
  @ApiProperty() scheduledAt: string;
  @ApiProperty({ enum: BookingTypeDto }) bookingType: BookingTypeDto;
  @ApiProperty({ enum: BookingStatusDto }) status: BookingStatusDto;
  @ApiProperty({ type: BarberBookingDetailPricingDto }) pricing: BarberBookingDetailPricingDto;
  @ApiProperty({ nullable: true, type: String }) confirmedAt: string | null;
  @ApiProperty({ nullable: true, type: String }) cancelledAt: string | null;
  @ApiProperty({ nullable: true, enum: ['client', 'barber'] }) cancelledBy: 'client' | 'barber' | null;
  @ApiProperty() noShowCharged: boolean;
  @ApiProperty({ nullable: true, type: Number }) noShowChargeAmountUsd: number | null;
  @ApiProperty() reviewLeftByClient: boolean;
  @ApiProperty() isRecurring: boolean;
  @ApiProperty({ nullable: true, type: String }) recurringBookingId: string | null;
  @ApiProperty() createdAt: string;
}

export class BarberBookingDetailResponseDto {
  @ApiProperty({ type: BarberBookingDetailDto }) booking: BarberBookingDetailDto;
}
