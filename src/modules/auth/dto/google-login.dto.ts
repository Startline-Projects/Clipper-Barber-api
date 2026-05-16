import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GoogleLoginDto {
  @ApiProperty({
    description:
      'Google OIDC id_token obtained on the device via native Google Sign-In (e.g. expo-auth-session or @react-native-google-signin).',
  })
  @IsString()
  @MinLength(10)
  idToken!: string;

  @ApiProperty({
    required: false,
    description: 'Optional Google access_token. Pass it only if the id_token does not carry a nonce.',
  })
  @IsOptional()
  @IsString()
  accessToken?: string;

  @ApiProperty({
    required: false,
    description:
      'Optional username to assign on first sign-in. Ignored if the account already exists. If omitted, a username is derived from the email local-part.',
  })
  @IsOptional()
  @IsString()
  username?: string;
}
