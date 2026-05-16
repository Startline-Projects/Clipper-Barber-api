import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailDto {
  @ApiProperty({
    description:
      'The `token_hash` query parameter from the Supabase confirmation email link (type=signup or type=email).',
  })
  @IsString()
  @MinLength(10)
  token!: string;

  @ApiProperty({
    required: false,
    enum: ['signup', 'email'],
    default: 'signup',
    description:
      'OTP type. Use `signup` for the initial confirmation email and `email` for email-change confirmations.',
  })
  @IsOptional()
  @IsString()
  type?: 'signup' | 'email';
}

export class ResendVerificationDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;
}
