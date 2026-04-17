import {
  IsISO8601,
  IsUUID,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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

export class GetAvailabilityQueryDto {
  @ApiProperty({ description: 'Service UUID', format: 'uuid' })
  @IsUUID()
  serviceId: string;

  @ApiProperty({ description: 'Start date in YYYY-MM-DD format', example: '2026-04-15' })
  @IsISO8601()
  startDate: string;

  @ApiProperty({ description: 'End date in YYYY-MM-DD format', example: '2026-04-21' })
  @IsISO8601()
  @Validate(IsEndDateValidConstraint)
  endDate: string;
}
