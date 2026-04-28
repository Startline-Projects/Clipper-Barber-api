import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { SubscriptionPlanDto } from './create-subscription.dto';

export class SwitchPlanDto {
  @ApiProperty({
    enum: SubscriptionPlanDto,
    example: SubscriptionPlanDto.YEARLY,
    description:
      'Target plan. Only monthly → yearly is allowed; the reverse direction returns 409.',
  })
  @IsEnum(SubscriptionPlanDto)
  plan: SubscriptionPlanDto;
}
