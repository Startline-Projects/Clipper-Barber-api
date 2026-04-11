import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

export class ReorderBarberServicesDto {
  @ApiProperty({
    description: 'Ordered list of service IDs — first item gets sort_order 0',
    type: [String],
    example: ['uuid-1', 'uuid-2', 'uuid-3'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  serviceIds: string[];
}
