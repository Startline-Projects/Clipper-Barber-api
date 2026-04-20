import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceType } from './create-barber-service.dto';

export class BarberServiceDto {
  @ApiProperty() id: string;
  @ApiProperty() barberId: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ServiceType }) serviceType: ServiceType;
  @ApiProperty() durationMinutes: number;
  @ApiProperty() regularPriceUsd: number;
  @ApiPropertyOptional({ nullable: true }) afterHoursPriceUsd: number | null;
  @ApiPropertyOptional({ nullable: true }) dayOffPriceUsd: number | null;
  @ApiPropertyOptional({ nullable: true }) recurringPriceUsd: number | null;
  @ApiProperty() isActive: boolean;
  @ApiProperty() sortOrder: number;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}

export class BarberServiceResponseDto {
  @ApiProperty() success: boolean;
  @ApiProperty({ type: BarberServiceDto }) data: BarberServiceDto;
}

export class BarberServicesListResponseDto {
  @ApiProperty() success: boolean;
  @ApiProperty({ type: [BarberServiceDto] }) data: BarberServiceDto[];
}
