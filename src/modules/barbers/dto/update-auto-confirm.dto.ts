import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateAutoConfirmDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;
}
