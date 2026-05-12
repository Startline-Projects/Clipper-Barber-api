import { ApiProperty } from '@nestjs/swagger';
import { BookingTypeDto } from '../../bookings/dto/preview-booking.dto';
import { BookingStatusDto } from './list-barber-bookings-query.dto';
import {
  BarberBookingClientSummaryDto,
  BarberBookingServiceItemDto,
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
  @ApiProperty({ type: [BarberBookingServiceItemDto] }) services: BarberBookingServiceItemDto[];
  @ApiProperty({ example: 60 }) totalDurationMinutes: number;
  @ApiProperty({ example: '2026-05-12T00:30:00.000Z', description: 'UTC instant (ISO 8601)' })
  scheduledAt: string;
  @ApiProperty({ example: 'America/New_York', description: 'Barber IANA timezone' })
  timezone: string;
  @ApiProperty({ example: '2026-05-11', description: 'Local calendar date in `timezone` (YYYY-MM-DD)' })
  appointmentDate: string;
  @ApiProperty({ example: '20:30', description: 'Local wall-clock in `timezone` (HH:MM)' })
  appointmentTime: string;
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
