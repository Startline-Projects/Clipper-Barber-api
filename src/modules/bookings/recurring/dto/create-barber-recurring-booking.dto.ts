import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsEnum,
  IsInt,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  BookingServiceSelectionDto,
  MAX_SERVICES_PER_BOOKING,
} from '../../dto/preview-booking.dto';
import { RecurringBookingFrequency } from './create-recurring-booking.dto';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

// Barber-initiated recurring booking creation. Same shape as the client DTO
// minus barberId (taken from the JWT) plus clientId.
export class CreateBarberRecurringBookingDto {
  @ApiProperty({ format: 'uuid', description: 'Client auth user ID' })
  @IsUUID()
  clientId: string;

  @ApiProperty({
    type: [BookingServiceSelectionDto],
    description:
      'Ordered list of services that make up each occurrence. Services are performed back-to-back and each carries its own bookingType (regular/day_off).',
  })
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SERVICES_PER_BOOKING)
  @ValidateNested({ each: true })
  @Type(() => BookingServiceSelectionDto)
  services: BookingServiceSelectionDto[];

  @ApiProperty({ example: 2, description: '0 = Sunday, 6 = Saturday' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiProperty({ example: '09:00', description: 'HH:mm' })
  @Matches(TIME_REGEX, { message: 'slotTime must be in HH:mm format' })
  slotTime: string;

  @ApiProperty({ enum: RecurringBookingFrequency, example: RecurringBookingFrequency.WEEKLY })
  @IsEnum(RecurringBookingFrequency)
  frequency: RecurringBookingFrequency;
}
