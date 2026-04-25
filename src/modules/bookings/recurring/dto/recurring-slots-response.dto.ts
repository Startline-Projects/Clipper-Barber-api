import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RecurringSlotDto {
  @ApiProperty({ example: '09:00' })
  time: string;

  @ApiProperty()
  available: boolean;
}

export class RecurringSlotsResponseDto {
  @ApiProperty({ example: 2, description: '0 = Sunday, 6 = Saturday' })
  dayOfWeek: number;

  @ApiProperty({
    description:
      'False when the barber, one of the services, or this day does not support recurring bookings. The other fields will be empty/null in that case.',
  })
  recurringAvailable: boolean;

  @ApiProperty({
    type: [String],
    example: ['weekly', 'biweekly'],
    description: 'Allowed recurring frequencies for this day',
  })
  recurringFrequencyOptions: Array<'weekly' | 'biweekly'>;

  @ApiPropertyOptional({
    nullable: true,
    example: 55.0,
    description:
      'Summed per-occurrence price across all selected services: sum(service.recurring_price_usd) + (schedule.recurring_extra_charge_usd ?? 0)',
  })
  recurringPriceUsd: number | null;

  @ApiProperty({ example: 60, description: 'Summed duration of all selected services, in minutes.' })
  totalDurationMinutes: number;

  @ApiProperty({ type: [RecurringSlotDto] })
  slots: RecurringSlotDto[];
}
