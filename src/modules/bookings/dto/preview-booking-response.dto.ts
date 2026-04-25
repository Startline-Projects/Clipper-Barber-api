import { ApiProperty } from '@nestjs/swagger';
import { BookingTypeDto } from './preview-booking.dto';

export class BookingServicePricingDto {
  @ApiProperty() basePrice: number;
  @ApiProperty() additionalCost: number;
  @ApiProperty() totalPrice: number;
}

export class BookingServiceSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() durationMinutes: number;
  @ApiProperty({ enum: BookingTypeDto }) bookingType: BookingTypeDto;
  @ApiProperty() startOffsetMinutes: number;
  @ApiProperty({ type: BookingServicePricingDto }) pricing: BookingServicePricingDto;
}

export class BookingBarberSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

export class BookingPricingDto {
  @ApiProperty() basePrice: number;
  @ApiProperty() additionalCost: number;
  @ApiProperty() totalPrice: number;
}

export class BookingPreviewDto {
  @ApiProperty() scheduledAt: string;
  @ApiProperty() totalDurationMinutes: number;
  @ApiProperty({ type: [BookingServiceSummaryDto] }) services: BookingServiceSummaryDto[];
  @ApiProperty({ type: BookingPricingDto }) pricing: BookingPricingDto;
  @ApiProperty({ type: BookingBarberSummaryDto }) barber: BookingBarberSummaryDto;
}

export class PreviewBookingResponseDto {
  @ApiProperty({ type: BookingPreviewDto }) preview: BookingPreviewDto;
}
