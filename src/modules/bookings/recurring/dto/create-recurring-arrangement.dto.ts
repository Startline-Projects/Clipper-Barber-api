import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  BookingServiceSelectionDto,
  MAX_SERVICES_PER_BOOKING,
} from '../../dto/preview-booking.dto';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export enum RecurringArrangementFrequency {
  WEEKLY = 'weekly',
  BIWEEKLY = 'biweekly',
  EVERY_N_WEEKS = 'every_n_weeks',
  MONTHLY = 'monthly',
}

export enum RecurringArrangementEndType {
  NONE = 'none',
  AFTER_COUNT = 'after_count',
  ON_DATE = 'on_date',
}

export class CreateRecurringArrangementDto {
  @ApiProperty() @IsUUID() clientId: string;

  @ApiProperty({
    type: [BookingServiceSelectionDto],
    description:
      'Ordered list of services performed back-to-back per occurrence. Each carries its own bookingType.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SERVICES_PER_BOOKING)
  @ValidateNested({ each: true })
  @Type(() => BookingServiceSelectionDto)
  services: BookingServiceSelectionDto[];

  @ApiProperty({ example: 6, description: '0 = Sunday, 6 = Saturday' })
  @IsInt() @Min(0) @Max(6)
  dayOfWeek: number;

  @ApiProperty({ example: '14:00', description: 'HH:mm — when the appointment starts.' })
  @Matches(TIME_REGEX, { message: 'timeOfDay must be in HH:mm format' })
  timeOfDay: string;

  @ApiProperty({ enum: RecurringArrangementFrequency })
  @IsEnum(RecurringArrangementFrequency)
  frequency: RecurringArrangementFrequency;

  @ApiPropertyOptional({
    minimum: 2,
    description: 'Required and ≥ 2 only when frequency = every_n_weeks.',
  })
  @IsOptional() @IsInt() @Min(2) @Max(52)
  intervalN?: number;

  @ApiProperty({ example: '2026-05-09', description: 'YYYY-MM-DD. Today or future.' })
  @IsISO8601({ strict: true })
  startDate: string;

  @ApiProperty({ enum: RecurringArrangementEndType })
  @IsEnum(RecurringArrangementEndType)
  endType: RecurringArrangementEndType;

  @ApiPropertyOptional({ minimum: 1, description: 'Required when endType = after_count.' })
  @IsOptional() @IsInt() @Min(1) @Max(520)
  endCount?: number;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD. Required when endType = on_date.' })
  @IsOptional() @IsISO8601({ strict: true })
  endDate?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional() @IsString() @MaxLength(1000)
  noteToClient?: string;
}
