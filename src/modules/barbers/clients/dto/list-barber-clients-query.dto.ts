import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum BarberClientsSortDto {
  LAST_VISIT = 'lastVisit',
  TOTAL_SPEND = 'totalSpend',
  TOTAL_VISITS = 'totalVisits',
  NAME = 'name',
}

export enum BarberClientsOrderDto {
  ASC = 'asc',
  DESC = 'desc',
}

export class ListBarberClientsQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive partial match on the client name',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: BarberClientsSortDto, default: BarberClientsSortDto.LAST_VISIT })
  @IsOptional()
  @IsEnum(BarberClientsSortDto)
  sortBy?: BarberClientsSortDto;

  @ApiPropertyOptional({ enum: BarberClientsOrderDto, default: BarberClientsOrderDto.DESC })
  @IsOptional()
  @IsEnum(BarberClientsOrderDto)
  order?: BarberClientsOrderDto;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'When true, only return clients with at least one future booking',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return value;
    return value === 'true' || value === '1';
  })
  @IsBoolean()
  hasUpcoming?: boolean;
}
