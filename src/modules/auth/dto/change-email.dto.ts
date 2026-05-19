import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangeEmailDto {
  @ApiProperty({ minLength: 8, description: 'Current account password — required for re-authentication' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  currentPassword!: string;

  @ApiProperty({ example: 'new.user@example.com', description: 'New email address — must not already be in use' })
  @IsEmail()
  newEmail!: string;
}
