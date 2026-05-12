import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty } from 'class-validator';

export class UpdateInHouseServicesDto {
  @ApiProperty({ example: true })
  @IsNotEmpty()
  @IsBoolean()
  enabled: boolean;
}

export class InHouseServicesResponseDto {
  @ApiProperty()
  inHouseServices: boolean;
}
