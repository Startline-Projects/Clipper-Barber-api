import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, Matches, Min } from 'class-validator';

export enum RecurringFrequencyOption {
  WEEKLY = 'weekly',
  BIWEEKLY = 'biweekly',
  BOTH = 'both',
}

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_EXAMPLE = '09:00';

export class UpdateScheduleDayDto {
  @ApiPropertyOptional({ description: 'Mark the day as working or off' })
  @IsOptional()
  @IsBoolean()
  isWorking?: boolean;

  @ApiPropertyOptional({ example: TIME_EXAMPLE, description: 'HH:mm format' })
  @IsOptional()
  @Matches(TIME_REGEX, { message: 'regularStartTime must be in HH:mm format' })
  regularStartTime?: string;

  @ApiPropertyOptional({ example: '17:00', description: 'HH:mm format' })
  @IsOptional()
  @Matches(TIME_REGEX, { message: 'regularEndTime must be in HH:mm format' })
  regularEndTime?: string;

  @ApiPropertyOptional({ enum: [15, 30, 45, 60] })
  @IsOptional()
  @IsInt()
  @IsIn([15, 30, 45, 60], { message: 'slotDurationMinutes must be one of 15, 30, 45, 60' })
  slotDurationMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  afterHoursEnabled?: boolean;

  @ApiPropertyOptional({ example: '18:00', description: 'HH:mm format' })
  @IsOptional()
  @Matches(TIME_REGEX, { message: 'afterHoursStart must be in HH:mm format' })
  afterHoursStart?: string;

  @ApiPropertyOptional({ example: '21:00', description: 'HH:mm format' })
  @IsOptional()
  @Matches(TIME_REGEX, { message: 'afterHoursEnd must be in HH:mm format' })
  afterHoursEnd?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  dayOffBookingEnabled?: boolean;

  @ApiPropertyOptional({ example: '10:00', description: 'HH:mm format' })
  @IsOptional()
  @Matches(TIME_REGEX, { message: 'dayOffStartTime must be in HH:mm format' })
  dayOffStartTime?: string;

  @ApiPropertyOptional({ example: '14:00', description: 'HH:mm format' })
  @IsOptional()
  @Matches(TIME_REGEX, { message: 'dayOffEndTime must be in HH:mm format' })
  dayOffEndTime?: string;

  @ApiPropertyOptional({ example: 60, description: 'Minimum minutes of advance notice required' })
  @IsOptional()
  @IsInt()
  @Min(0, { message: 'advanceNoticeMinutes must be >= 0' })
  advanceNoticeMinutes?: number;

  @ApiPropertyOptional({ description: 'Whether this day is available for recurring bookings' })
  @IsOptional()
  @IsBoolean()
  recurringEnabled?: boolean;

  @ApiPropertyOptional({
    enum: RecurringFrequencyOption,
    description: 'Allowed recurring frequency on this day; required when recurringEnabled is true',
  })
  @IsOptional()
  @IsEnum(RecurringFrequencyOption, {
    message: 'recurringFrequency must be one of weekly, biweekly, both',
  })
  recurringFrequency?: RecurringFrequencyOption;

  @ApiPropertyOptional({
    example: 10.0,
    description: 'Optional flat surcharge added on top of service.recurringPriceUsd for this day',
  })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'recurringExtraChargeUsd must be >= 0' })
  recurringExtraChargeUsd?: number;
}
