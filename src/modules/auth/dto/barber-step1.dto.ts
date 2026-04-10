import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BarberStep1Dto {
  @ApiProperty({ example: 'John Doe', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  fullName!: string;

  @ApiProperty({ example: 'barber@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}
