import { ApiProperty } from '@nestjs/swagger';

export type NoShowChargeSkippedReason =
  | 'no_card'
  | 'no_connect'
  | 'disabled'
  | 'connect_not_charges_enabled';

export class NoShowChargeResultDto {
  @ApiProperty({ example: true })
  charged: boolean;

  @ApiProperty({ example: 25, nullable: true })
  amountUsd: number | null;

  @ApiProperty({ example: '5d63c5b4-9b59-4f04-9cf8-83a5c5e9a90b', nullable: true })
  noShowChargeId: string | null;

  @ApiProperty({
    example: 'no_connect',
    nullable: true,
    description:
      'Set when charged=false. One of no_card | no_connect | disabled | connect_not_charges_enabled.',
  })
  reason: NoShowChargeSkippedReason | null;
}
