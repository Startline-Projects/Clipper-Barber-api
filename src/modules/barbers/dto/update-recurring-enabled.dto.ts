import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty } from 'class-validator';

export class UpdateRecurringEnabledDto {
  @ApiProperty({ example: true })
  @IsNotEmpty()
  @IsBoolean()
  enabled: boolean;
}

export class RecurringEnabledResponseDto {
  @ApiProperty()
  recurringEnabled: boolean;
}
