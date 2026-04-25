import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RemoveDeviceTokenDto {
  @ApiProperty({
    description: 'The exact token previously registered via POST /device-token.',
    example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;
}

export class RemoveDeviceTokenResponseDto {
  @ApiProperty()
  removed!: boolean;
}
