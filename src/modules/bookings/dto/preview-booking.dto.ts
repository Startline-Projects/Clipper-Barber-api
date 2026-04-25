import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsEnum,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';

export enum BookingTypeDto {
  REGULAR = 'regular',
  AFTER_HOURS = 'after_hours',
  DAY_OFF = 'day_off',
}

export const MAX_SERVICES_PER_BOOKING = 4;

export class BookingServiceSelectionDto {
  @ApiProperty({ format: 'uuid', description: 'Barber service ID' })
  @IsUUID()
  barberServiceId: string;

  @ApiProperty({ enum: BookingTypeDto, example: BookingTypeDto.REGULAR })
  @IsEnum(BookingTypeDto)
  bookingType: BookingTypeDto;
}

export class PreviewBookingDto {
  @ApiProperty({ format: 'uuid', description: 'Barber auth user ID' })
  @IsUUID()
  barberId: string;

  @ApiProperty({
    type: [BookingServiceSelectionDto],
    description:
      'Ordered list of services that make up this booking. Services are performed back-to-back starting at slotTime. Each service carries its own bookingType.',
  })
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SERVICES_PER_BOOKING)
  @ValidateNested({ each: true })
  @Type(() => BookingServiceSelectionDto)
  services: BookingServiceSelectionDto[];

  @ApiProperty({
    example: '2026-04-15',
    description: "Calendar date in the barber's local time (YYYY-MM-DD)",
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be in YYYY-MM-DD format' })
  date: string;

  @ApiProperty({
    example: '14:00',
    description: "Slot start time in the barber's local time (HH:MM, 24-hour). The block runs from this time for the summed duration of all selected services.",
  })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'slotTime must be in HH:MM 24-hour format' })
  slotTime: string;
}
