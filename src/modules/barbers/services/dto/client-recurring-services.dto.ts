import { ApiProperty } from '@nestjs/swagger';
import { ServiceType } from './create-barber-service.dto';

export class ClientRecurringServiceItemDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ServiceType }) serviceType: ServiceType;
  @ApiProperty() durationMinutes: number;
  @ApiProperty() regularPrice: number;
  @ApiProperty({
    description:
      'Lowest possible total recurring price across all recurring-enabled schedule days (service.recurring_price_usd + min(recurring_extra_charge_usd, 0))',
  })
  recurringPriceFrom: number;
}

export class ClientRecurringServicesResponseDto {
  @ApiProperty({ type: [ClientRecurringServiceItemDto] })
  services: ClientRecurringServiceItemDto[];
}
