import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { MAX_SERVICES_PER_BOOKING } from '../../dto/preview-booking.dto';

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter((v) => v.length > 0);
  if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter((v) => v.length > 0);
  return [];
};

export class GetRecurringSlotsQueryDto {
  @ApiProperty({
    description: 'One or more barber service UUIDs (comma-separated or repeated).',
    isArray: true,
    type: String,
    format: 'uuid',
  })
  @Transform(({ value }) => toStringArray(value))
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SERVICES_PER_BOOKING)
  @IsUUID('4', { each: true })
  serviceIds: string[];

  @ApiProperty({ example: 2, description: '0 = Sunday, 6 = Saturday' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiPropertyOptional({
    example: '2026-05-26',
    description:
      'YYYY-MM-DD. Optional. When supplied, slot availability is checked against one-off bookings on matching days from this date forward instead of from today. Useful for skipping near-term booked dates.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  startDate?: string;
}
