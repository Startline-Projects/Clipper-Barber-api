import { ApiProperty } from '@nestjs/swagger';

export class ScheduleDayDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'uuid' })
  barberId: string;

  @ApiProperty({ example: 1, description: '0 = Sunday, 6 = Saturday' })
  dayOfWeek: number;

  @ApiProperty()
  isWorking: boolean;

  @ApiProperty({ example: '09:00', nullable: true })
  regularStartTime: string | null;

  @ApiProperty({ example: '17:00', nullable: true })
  regularEndTime: string | null;

  @ApiProperty({ example: 30, description: 'One of 15, 30, 45, 60' })
  slotDurationMinutes: number;

  @ApiProperty()
  afterHoursEnabled: boolean;

  @ApiProperty({ example: '18:00', nullable: true })
  afterHoursStart: string | null;

  @ApiProperty({ example: '21:00', nullable: true })
  afterHoursEnd: string | null;

  @ApiProperty()
  dayOffBookingEnabled: boolean;

  @ApiProperty({ example: '10:00', nullable: true })
  dayOffStartTime: string | null;

  @ApiProperty({ example: '14:00', nullable: true })
  dayOffEndTime: string | null;

  @ApiProperty({ example: 60, description: 'Minimum minutes before booking' })
  advanceNoticeMinutes: number;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export class ScheduleDayResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ type: ScheduleDayDto })
  data: ScheduleDayDto;
}

export class ScheduleListResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ type: [ScheduleDayDto] })
  data: ScheduleDayDto[];
}
