import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsPositive, ValidateIf } from 'class-validator';

export enum ReminderTargetDto {
  CLIENT = 'client',
  SELF = 'self',
}

export enum ReminderTypeDto {
  HOURS_BEFORE = 'hours_before',
  MINUTES_BEFORE = 'minutes_before',
  MORNING_OF = 'morning_of',
}

export class UpdateReminderGroupDto {
  @ApiProperty({ description: 'Whether this reminder group is active.' })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({
    enum: ReminderTypeDto,
    description: 'Single reminder option for the group.',
  })
  @IsEnum(ReminderTypeDto)
  reminderType!: ReminderTypeDto;

  @ApiProperty({
    required: false,
    description: 'Hours before the appointment. Required when reminderType=hours_before.',
  })
  @ValidateIf((o: UpdateReminderGroupDto) => o.reminderType === ReminderTypeDto.HOURS_BEFORE)
  @IsInt()
  @IsPositive()
  offsetHours?: number;

  @ApiProperty({
    required: false,
    description: 'Minutes before the appointment. Required when reminderType=minutes_before.',
  })
  @ValidateIf((o: UpdateReminderGroupDto) => o.reminderType === ReminderTypeDto.MINUTES_BEFORE)
  @IsInt()
  @IsPositive()
  offsetMinutes?: number;
}

export class ReminderGroupDto {
  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ enum: ReminderTypeDto })
  reminderType!: ReminderTypeDto;

  @ApiProperty({ nullable: true, type: Number })
  offsetHours!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  offsetMinutes!: number | null;
}

export class ReminderSettingsResponseDto {
  @ApiProperty({ type: ReminderGroupDto, description: 'Reminders sent to the barber\'s clients.' })
  client!: ReminderGroupDto;

  @ApiProperty({ type: ReminderGroupDto, description: 'Reminders sent to the barber.' })
  self!: ReminderGroupDto;
}
