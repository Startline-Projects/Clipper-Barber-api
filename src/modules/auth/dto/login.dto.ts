import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import messages from '../../../common/messages.json';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({
    enum: ['barber', 'client'],
    description: 'Role is sent by the app, not entered by the user',
  })
  @IsEnum(['barber', 'client'], { message: messages.validation.ROLE_INVALID })
  role!: 'barber' | 'client';
}
