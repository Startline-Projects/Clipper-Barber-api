import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export enum ServiceType {
  HAIRCUT = 'haircut',
  BEARD = 'beard',
  HAIRCUT_BEARD = 'haircut_beard',
  EYEBROWS = 'eyebrows',
  OTHER = 'other',
}

export class CreateBarberServiceDto {
  @ApiProperty({ example: 'Skin Fade', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ enum: ServiceType, example: ServiceType.HAIRCUT })
  @IsEnum(ServiceType)
  serviceType: ServiceType;

  @ApiProperty({ enum: [15, 30, 45, 60], example: 30 })
  @IsIn([15, 30, 45, 60])
  durationMinutes: number;

  @ApiProperty({ example: 35.0, description: 'Base price in USD' })
  @IsNumber()
  @Min(0)
  regularPriceUsd: number;

  @ApiPropertyOptional({ example: 45.0, description: 'After-hours price in USD' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  afterHoursPriceUsd?: number;

  @ApiPropertyOptional({ example: 55.0, description: 'Day-off price in USD' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  dayOffPriceUsd?: number;
}
