import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsInt, IsUUID, Max, Min } from 'class-validator';
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
}
