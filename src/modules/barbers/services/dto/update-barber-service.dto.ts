import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ServiceType } from './create-barber-service.dto';

export class UpdateBarberServiceDto {
  @ApiPropertyOptional({ example: 'Skin Fade', maxLength: 100 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ enum: ServiceType })
  @IsOptional()
  @IsEnum(ServiceType)
  serviceType?: ServiceType;

  @ApiPropertyOptional({ enum: [15, 30, 45, 60] })
  @IsOptional()
  @IsIn([15, 30, 45, 60])
  durationMinutes?: number;

  @ApiPropertyOptional({ example: 35.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  regularPriceUsd?: number;

  @ApiPropertyOptional({ nullable: true, example: 45.0, description: 'Pass null to clear' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  afterHoursPriceUsd?: number | null;

  @ApiPropertyOptional({ nullable: true, example: 55.0, description: 'Pass null to clear' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  dayOffPriceUsd?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 40.0,
    description: 'Per-occurrence recurring price. Pass null to disable recurring for this service.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  recurringPriceUsd?: number | null;

  @ApiPropertyOptional({ example: 2, description: 'Display sort order' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
