import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsUUID, Matches, Max, Min } from 'class-validator';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export enum RecurringBookingFrequency {
  WEEKLY = 'weekly',
  BIWEEKLY = 'biweekly',
}

export class CreateRecurringBookingDto {
  @ApiProperty() @IsUUID() barberId: string;
  @ApiProperty() @IsUUID() barberServiceId: string;

  @ApiProperty({ example: 2, description: '0 = Sunday, 6 = Saturday' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiProperty({ example: '09:00', description: 'HH:mm' })
  @Matches(TIME_REGEX, { message: 'slotTime must be in HH:mm format' })
  slotTime: string;

  @ApiProperty({ enum: RecurringBookingFrequency, example: RecurringBookingFrequency.WEEKLY })
  @IsEnum(RecurringBookingFrequency)
  frequency: RecurringBookingFrequency;
}
