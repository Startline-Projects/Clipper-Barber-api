import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  RecurringBookingPartyDto,
  RecurringBookingServiceLiteDto,
  RecurringBookingStatus,
} from './recurring-booking.dto';

export class RecurringBookingListItemDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'active' }) status: RecurringBookingStatus;
  @ApiProperty() isRenewal: boolean;
  @ApiProperty() dayOfWeek: number;
  @ApiProperty({ example: '09:00' }) slotTime: string;
  @ApiProperty({ example: 'weekly' }) frequency: 'weekly' | 'biweekly';
  @ApiProperty({ example: 55.0 }) priceUsd: number;
  @ApiProperty({ type: RecurringBookingServiceLiteDto })
  service: RecurringBookingServiceLiteDto;
  @ApiProperty({ type: RecurringBookingPartyDto }) barber: RecurringBookingPartyDto;
  @ApiProperty({ type: RecurringBookingPartyDto }) client: RecurringBookingPartyDto;
  @ApiPropertyOptional({ nullable: true, type: String, description: "Client's profile photo URL (raw public URL from clients.profile_photo_url)." })
  clientProfilePhotoUrl: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) nextOccurrenceAt: string | null;
  @ApiProperty() createdAt: string;
}

export class RecurringBookingsListResponseDto {
  @ApiProperty({ type: [RecurringBookingListItemDto] })
  recurringBookings: RecurringBookingListItemDto[];

  @ApiProperty({ nullable: true, type: String }) nextCursor: string | null;
  @ApiProperty() hasMore: boolean;
}
