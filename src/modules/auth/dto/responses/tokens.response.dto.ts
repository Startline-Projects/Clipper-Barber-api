import { ApiProperty } from '@nestjs/swagger';

export class TokensResponseDto {
  @ApiProperty({ description: 'JWT access token' })
  accessToken: string;

  @ApiProperty({ description: 'Refresh token to obtain new access tokens' })
  refreshToken: string;
}
