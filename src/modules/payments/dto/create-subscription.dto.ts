import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, Matches } from 'class-validator';

export enum SubscriptionPlanDto {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

export class CreateSubscriptionDto {
  @ApiProperty({ enum: SubscriptionPlanDto, example: SubscriptionPlanDto.MONTHLY })
  @IsEnum(SubscriptionPlanDto)
  plan: SubscriptionPlanDto;

  @ApiProperty({
    example: 'pm_card_visa',
    description:
      'Stripe PaymentMethod ID returned by Stripe.js / mobile SDK after card collection.',
  })
  @IsString()
  @Matches(/^pm_[A-Za-z0-9_]+$/, {
    message: 'paymentMethodId must look like a Stripe PaymentMethod ID (pm_…)',
  })
  paymentMethodId: string;
}
