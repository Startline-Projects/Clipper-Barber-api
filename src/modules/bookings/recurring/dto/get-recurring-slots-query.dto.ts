import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class GetRecurringSlotsQueryDto {
  @ApiProperty({ description: 'Barber service UUID' })
  @IsUUID()
  serviceId: string;

  @ApiProperty({ example: 2, description: '0 = Sunday, 6 = Saturday' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;
}
