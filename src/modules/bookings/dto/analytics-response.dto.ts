import { ApiProperty } from '@nestjs/swagger';
import { AnalyticsPeriodDto } from './analytics-query.dto';

export class AnalyticsBucketDto {
  @ApiProperty({ example: 14 })
  count: number;

  @ApiProperty({ example: 630 })
  total_usd: number;
}

export class AnalyticsStandardBookingsDto {
  @ApiProperty({ type: AnalyticsBucketDto })
  regular: AnalyticsBucketDto;

  @ApiProperty({ type: AnalyticsBucketDto })
  after_hours: AnalyticsBucketDto;

  @ApiProperty({ type: AnalyticsBucketDto })
  day_off: AnalyticsBucketDto;
}

export class AnalyticsRecurringEntryDto {
  @ApiProperty({ format: 'uuid' }) arrangement_id: string;
  @ApiProperty({ example: 'Mike R.' }) client_name: string;
  @ApiProperty({ example: 'Skin fade' }) service_name: string;
  @ApiProperty({ example: 2, description: '0=Sunday … 6=Saturday' }) day_of_week: number;
  @ApiProperty({ example: '10:00:00' }) time_slot: string;
  @ApiProperty({ example: 'weekly', enum: ['weekly', 'biweekly'] }) frequency: string;
  @ApiProperty({ example: 1 }) occurrences_completed: number;
  @ApiProperty({ example: 45 }) total_usd: number;
}

export class AnalyticsRecurringDto {
  @ApiProperty({ example: 6 })
  total_occurrences_completed: number;

  @ApiProperty({ example: 290 })
  total_usd: number;

  @ApiProperty({ type: [AnalyticsRecurringEntryDto] })
  per_arrangement: AnalyticsRecurringEntryDto[];
}

export class AnalyticsResponseDto {
  @ApiProperty({ enum: AnalyticsPeriodDto, example: AnalyticsPeriodDto.WEEK })
  period: AnalyticsPeriodDto;

  @ApiProperty({ example: 7 })
  period_days: number;

  @ApiProperty({ example: '2026-04-20T00:00:00.000Z' })
  window_start: string;

  @ApiProperty({ example: '2026-04-27T00:00:00.000Z' })
  window_end: string;

  @ApiProperty({ example: 1280 })
  total_earnings_usd: number;

  @ApiProperty({ type: AnalyticsStandardBookingsDto })
  standard_bookings: AnalyticsStandardBookingsDto;

  @ApiProperty({ type: AnalyticsRecurringDto })
  recurring: AnalyticsRecurringDto;
}
