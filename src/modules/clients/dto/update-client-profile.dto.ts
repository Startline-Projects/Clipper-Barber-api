import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import messages from '../../../common/messages.json';

export class UpdateClientProfileDto {
  @ApiPropertyOptional({ example: 'Jane Doe', minLength: 1, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: 'jane_doe',
    minLength: 3,
    maxLength: 30,
    description: 'Letters, numbers, and underscores only',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_]+$/, { message: messages.validation.USERNAME_INVALID })
  @MinLength(3)
  @MaxLength(30)
  username?: string;
}
