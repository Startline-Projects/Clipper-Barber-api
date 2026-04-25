import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export enum DevicePlatformDto {
  IOS = 'ios',
  ANDROID = 'android',
}

export class RegisterDeviceTokenDto {
  @ApiProperty({
    description:
      'Expo push token (ExponentPushToken[...]) or an FCM token. The backend stores it verbatim.',
    example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;

  @ApiProperty({ enum: DevicePlatformDto })
  @IsEnum(DevicePlatformDto)
  platform!: DevicePlatformDto;
}

export class RegisterDeviceTokenResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  token!: string;

  @ApiProperty({ enum: DevicePlatformDto })
  platform!: DevicePlatformDto;
}
