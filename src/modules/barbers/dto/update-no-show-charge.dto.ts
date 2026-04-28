import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateNoShowChargeDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    example: 25,
    required: false,
    description: 'Amount in USD to charge on no-show. Required when enabled is true.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amountUsd?: number;
}

export class NoShowChargeSettingsResponseDto {
  @ApiProperty({ example: true })
  enabled: boolean;

  @ApiProperty({ example: 25, nullable: true })
  amountUsd: number | null;
}
