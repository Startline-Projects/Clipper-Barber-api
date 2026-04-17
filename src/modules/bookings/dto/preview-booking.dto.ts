import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsUUID, Matches } from 'class-validator';

export enum BookingTypeDto {
  REGULAR = 'regular',
  AFTER_HOURS = 'after_hours',
  DAY_OFF = 'day_off',
}

export class PreviewBookingDto {
  @ApiProperty({ format: 'uuid', description: 'Barber auth user ID' })
  @IsUUID()
  barberId: string;

  @ApiProperty({ format: 'uuid', description: 'Barber service ID' })
  @IsUUID()
  barberServiceId: string;

  @ApiProperty({
    example: '2026-04-15',
    description: "Calendar date in the barber's local time (YYYY-MM-DD)",
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be in YYYY-MM-DD format' })
  date: string;

  @ApiProperty({
    example: '14:00',
    description: "Slot start time in the barber's local time (HH:MM, 24-hour)",
  })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'slotTime must be in HH:MM 24-hour format' })
  slotTime: string;

  @ApiProperty({ enum: BookingTypeDto, example: BookingTypeDto.REGULAR })
  @IsEnum(BookingTypeDto)
  bookingType: BookingTypeDto;
}
