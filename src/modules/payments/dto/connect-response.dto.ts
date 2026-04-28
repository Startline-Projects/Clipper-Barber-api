import { ApiProperty } from '@nestjs/swagger';

export class ConnectOnboardResponseDto {
  @ApiProperty({
    example: 'https://connect.stripe.com/setup/e/acct_1Oj...',
    description: 'One-time URL to send the barber to. Expires after first use.',
  })
  onboardingUrl: string;
}

export class ConnectStatusResponseDto {
  @ApiProperty({
    example: true,
    description: 'Whether the barber has a Stripe Connect account on file.',
  })
  connected: boolean;

  @ApiProperty({ example: true })
  chargesEnabled: boolean;

  @ApiProperty({ example: true })
  payoutsEnabled: boolean;

  @ApiProperty({
    example: ['individual.dob.day'],
    description: 'Verification fields Stripe is currently asking for. Empty when fully onboarded.',
  })
  requirementsCurrentlyDue: string[];
}

export class ConnectDisconnectResponseDto {
  @ApiProperty({ example: true })
  disconnected: boolean;
}
