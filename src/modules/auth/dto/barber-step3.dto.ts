import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import messages from '../../../common/messages.json';

export class BarberStep3Dto {
  @ApiPropertyOptional({ example: 'Master barber with 10 years of experience.', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @ApiPropertyOptional({ example: 'john.cuts', maxLength: 50, description: 'No @ symbol' })
  @IsOptional()
  @Matches(/^[a-zA-Z0-9._]+$/, { message: messages.validation.INSTAGRAM_INVALID })
  @MaxLength(50)
  instagramHandle?: string;
}
