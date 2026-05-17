import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginResponseDto {
  @ApiProperty({ description: 'JWT access token' })
  accessToken: string;

  @ApiProperty({ description: 'Refresh token' })
  refreshToken: string;

  @ApiProperty({ description: 'User UUID (user_id)' })
  id: string;

  @ApiProperty({ description: 'Authenticated user email' })
  email: string;

  @ApiProperty({ description: 'Display name — full name for barbers, username for clients' })
  username: string;

  @ApiProperty({
    description: 'True when the user has verified their email via the OTP flow.',
    example: false,
  })
  emailVerified: boolean;

  @ApiPropertyOptional({
    description:
      'Only present when barber onboarding is incomplete. Navigate the app to this route.',
    example: 'barber/step2',
  })
  redirectTo?: string;
}
