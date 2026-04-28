import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ minLength: 8, description: 'Current account password' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  currentPassword!: string;

  @ApiProperty({ minLength: 8, description: 'New password — must differ from the current one' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword!: string;
}
