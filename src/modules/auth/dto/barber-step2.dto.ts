import { IsNumber, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import messages from '../../../common/messages.json';

export class BarberStep2Dto {
  @ApiProperty({ example: 'The Fade Factory', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  shopName!: string;

  @ApiProperty({ example: '+1 (555) 123-4567' })
  @Matches(/^[+\d\s\-()]+$/, { message: messages.validation.PHONE_INVALID })
  phone!: string;

  @ApiProperty({ example: '123 Main St', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  streetAddress!: string;

  @ApiProperty({ example: 'Austin', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  city!: string;

  @ApiProperty({ example: 'TX', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  state!: string;

  @ApiProperty({ example: '78701' })
  @Matches(/^\d{5}(-\d{4})?$/, { message: messages.validation.ZIP_CODE_INVALID })
  zipCode!: string;

  @ApiProperty({ example: 30.2672, minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: -97.7431, minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;
}
