import {
  ArrayMaxSize,
  ArrayMinSize,
  IsISO8601,
  IsUUID,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { MAX_SERVICES_PER_BOOKING } from './preview-booking.dto';

@ValidatorConstraint({ name: 'IsEndDateValid', async: false })
class IsEndDateValidConstraint implements ValidatorConstraintInterface {
  public validate(endDate: string, args: ValidationArguments): boolean {
    const dto = args.object as { startDate?: string };
    if (!dto.startDate || !endDate) return true;
    const start = new Date(dto.startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return true;
    const maxEnd = new Date(start);
    maxEnd.setDate(maxEnd.getDate() + 14);
    return end >= start && end <= maxEnd;
  }

  public defaultMessage(): string {
    return 'endDate must be >= startDate and no more than 14 days after startDate';
  }
}

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter((v) => v.length > 0);
  if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter((v) => v.length > 0);
  return [];
};

export class GetAvailabilityQueryDto {
  @ApiProperty({
    description:
      'One or more barber service UUIDs (comma-separated or repeated). Services are stacked consecutively; availability returns only starts where the full block fits.',
    isArray: true,
    type: String,
    format: 'uuid',
    example: ['3f1b8c6a-…', 'a8e2f1c4-…'],
  })
  @Transform(({ value }) => toStringArray(value))
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SERVICES_PER_BOOKING)
  @IsUUID('4', { each: true })
  serviceIds: string[];

  @ApiProperty({ description: 'Start date in YYYY-MM-DD format', example: '2026-04-15' })
  @IsISO8601()
  startDate: string;

  @ApiProperty({ description: 'End date in YYYY-MM-DD format', example: '2026-04-21' })
  @IsISO8601()
  @Validate(IsEndDateValidConstraint)
  endDate: string;
}
