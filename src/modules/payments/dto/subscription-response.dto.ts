import { ApiProperty } from '@nestjs/swagger';
import { SubscriptionPlanDto } from './create-subscription.dto';

export type SubscriptionStatusDto = 'inactive' | 'active' | 'past_due' | 'cancelled';

export class CreateSubscriptionResponseDto {
  @ApiProperty({ example: 'sub_1OjE0xLkdIwHu7ix8...' })
  subscriptionId: string;

  @ApiProperty({
    example: 'inactive',
    description:
      'Mirror of clients.subscription_status. Will flip to active once the webhook for customer.subscription.created fires.',
  })
  status: SubscriptionStatusDto;

  @ApiProperty({
    example: 'pi_3OjE0xLkdIwHu7ix0pQR_secret_xyz',
    nullable: true,
    description:
      'Set when the latest invoice requires SCA confirmation on the device. Null once the subscription is active.',
  })
  clientSecret: string | null;
}

export class SubscriptionStateResponseDto {
  @ApiProperty({ example: 'active' })
  status: SubscriptionStatusDto;

  @ApiProperty({ enum: SubscriptionPlanDto, nullable: true })
  plan: SubscriptionPlanDto | null;

  @ApiProperty({
    example: '2026-05-27T00:00:00.000Z',
    nullable: true,
    description: 'When the current paid period ends. Mirrors clients.subscription_expires_at.',
  })
  currentPeriodEnd: string | null;

  @ApiProperty({ example: false })
  cancelAtPeriodEnd: boolean;
}

export class CancelSubscriptionResponseDto {
  @ApiProperty({ example: 'active' })
  status: SubscriptionStatusDto;

  @ApiProperty({ example: true })
  cancelAtPeriodEnd: boolean;

  @ApiProperty({ example: '2026-05-27T00:00:00.000Z', nullable: true })
  currentPeriodEnd: string | null;
}
