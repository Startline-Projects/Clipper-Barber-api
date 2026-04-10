import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import messages from '../../../common/messages.json';

export class ClientRegisterDto {
  @ApiProperty({ example: 'client@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ minLength: 8 })
  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({
    example: 'john_doe',
    minLength: 3,
    maxLength: 30,
    description: 'Letters, numbers, and underscores only',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^[a-zA-Z0-9_]+$/, { message: messages.validation.USERNAME_INVALID })
  @MinLength(3)
  @MaxLength(30)
  username: string;
}
