import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class GetBarberHomeQueryDto {
  @ApiPropertyOptional({
    example: 'Africa/Cairo',
    description:
      'IANA timezone override. Falls back to the barber profile timezone if omitted, then to UTC.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tz?: string;
}
