import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export enum AnalyticsPeriodDto {
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
}

export class AnalyticsQueryDto {
  @ApiProperty({ enum: AnalyticsPeriodDto, example: AnalyticsPeriodDto.WEEK })
  @IsEnum(AnalyticsPeriodDto)
  period: AnalyticsPeriodDto;
}
