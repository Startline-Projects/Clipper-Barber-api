import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class NotificationSettingsResponseDto {
  @ApiProperty({ description: 'Controls new_booking and cancelled_booking notifications.' })
  normal_bookings!: boolean;

  @ApiProperty({
    description:
      'Controls new_recurring_request, recurring_cancelled and recurring_paused notifications.',
  })
  recurring_bookings!: boolean;
}

export class UpdateNotificationSettingsDto {
  @ApiProperty()
  @IsBoolean()
  normal_bookings!: boolean;

  @ApiProperty()
  @IsBoolean()
  recurring_bookings!: boolean;
}
