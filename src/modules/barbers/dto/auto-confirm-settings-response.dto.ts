import { ApiProperty } from '@nestjs/swagger';

export class AutoConfirmSettingsResponseDto {
  @ApiProperty() allowAutoConfirm: boolean;
  @ApiProperty() autoConfirmToday: boolean;
}
