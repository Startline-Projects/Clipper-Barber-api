import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import {
  BookingTimeframeDto,
  BookingTypeFilterDto,
} from '../../barbers/dto/list-barber-bookings-query.dto';

export class ListClientBookingsQueryDto {
  @ApiProperty({ enum: BookingTimeframeDto, example: BookingTimeframeDto.UPCOMING })
  @IsEnum(BookingTimeframeDto)
  timeframe: BookingTimeframeDto;

  @ApiPropertyOptional({
    enum: BookingTypeFilterDto,
    description: 'one_off = non-recurring only; recurring = only bookings generated from a recurring subscription',
  })
  @IsOptional()
  @IsEnum(BookingTypeFilterDto)
  type?: BookingTypeFilterDto;

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
