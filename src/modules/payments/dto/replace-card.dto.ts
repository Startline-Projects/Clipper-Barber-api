import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class ReplaceCardDto {
  @ApiProperty({
    example: 'pm_card_mastercard',
    description: 'Stripe PaymentMethod ID to attach as the new default card.',
  })
  @IsString()
  @Matches(/^pm_[A-Za-z0-9_]+$/, {
    message: 'paymentMethodId must look like a Stripe PaymentMethod ID (pm_…)',
  })
  paymentMethodId: string;
}

export class CardActionResponseDto {
  @ApiProperty({ example: true })
  ok: boolean;

  @ApiProperty({ example: 'pm_card_mastercard', nullable: true })
  paymentMethodId: string | null;
}
