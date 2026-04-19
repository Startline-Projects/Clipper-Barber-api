import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { BookingTypeDto } from '../../bookings/dto/preview-booking.dto';

export enum BookingTimeframeDto {
  UPCOMING = 'upcoming',
  PAST = 'past',
}

export enum BookingStatusDto {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  NO_SHOW = 'no_show',
}

export class ListBarberBookingsQueryDto {
  @ApiProperty({ enum: BookingTimeframeDto, example: BookingTimeframeDto.UPCOMING })
  @IsEnum(BookingTimeframeDto)
  timeframe: BookingTimeframeDto;

  @ApiPropertyOptional({ enum: BookingTypeDto })
  @IsOptional()
  @IsEnum(BookingTypeDto)
  bookingType?: BookingTypeDto;

  @ApiPropertyOptional({ enum: BookingStatusDto })
  @IsOptional()
  @IsEnum(BookingStatusDto)
  status?: BookingStatusDto;

  @ApiPropertyOptional({ format: 'uuid', description: 'ID of the last booking from the previous page' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
