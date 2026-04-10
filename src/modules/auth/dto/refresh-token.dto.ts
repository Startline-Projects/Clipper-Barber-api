import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token received during login or signup' })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
