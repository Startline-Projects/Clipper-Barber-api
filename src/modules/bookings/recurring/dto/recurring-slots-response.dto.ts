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
      'False when the barber, service, or this day does not support recurring bookings. The other fields will be empty/null in that case.',
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
      'Exact total per-occurrence price for this day: service.recurring_price_usd + (schedule.recurring_extra_charge_usd ?? 0)',
  })
  recurringPriceUsd: number | null;

  @ApiProperty({ type: [RecurringSlotDto] })
  slots: RecurringSlotDto[];
}
