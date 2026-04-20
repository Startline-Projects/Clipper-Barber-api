import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class PauseRecurringBookingDto {
  @ApiProperty({ example: '2026-05-01', description: 'YYYY-MM-DD' })
  @IsDateString()
  pauseStartDate: string;

  @ApiPropertyOptional({
    example: '2026-05-31',
    description: 'YYYY-MM-DD. Omit for an indefinite pause starting at pauseStartDate.',
  })
  @IsOptional()
  @IsDateString()
  pauseEndDate?: string;
}
