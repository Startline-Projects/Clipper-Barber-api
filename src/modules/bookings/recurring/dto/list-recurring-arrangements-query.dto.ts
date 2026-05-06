import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export enum RecurringArrangementStatusFilter {
  PENDING_CLIENT_APPROVAL = 'pending_client_approval',
  ACTIVE = 'active',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
  ENDED = 'ended',
}

export class ListRecurringArrangementsQueryDto {
  @ApiPropertyOptional({ enum: RecurringArrangementStatusFilter })
  @IsOptional()
  @IsEnum(RecurringArrangementStatusFilter)
  status?: RecurringArrangementStatusFilter;

  @ApiPropertyOptional({ description: 'Barber-side only filter — restrict to one client.' })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cursor?: string;
}
