import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import messages from '../../../common/messages.json';

export class UpdateBarberProfileDto {
  @ApiPropertyOptional({ example: 'John Doe', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @ApiPropertyOptional({ example: 'The Fade Factory', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  shopName?: string;

  @ApiPropertyOptional({ example: '+1 (555) 123-4567' })
  @IsOptional()
  @Matches(/^[+\d\s\-()]+$/, { message: messages.validation.PHONE_INVALID })
  phone?: string;

  @ApiPropertyOptional({ example: '123 Main St', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  streetAddress?: string;

  @ApiPropertyOptional({ example: 'Austin', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ example: 'TX', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  state?: string;

  @ApiPropertyOptional({ example: '78701' })
  @IsOptional()
  @Matches(/^\d{5}(-\d{4})?$/, { message: messages.validation.ZIP_CODE_INVALID })
  zipCode?: string;

  @ApiPropertyOptional({ example: 30.2672, minimum: -90, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: -97.7431, minimum: -180, maximum: 180 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

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
