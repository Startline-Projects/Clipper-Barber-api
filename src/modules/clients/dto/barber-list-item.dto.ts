import { ApiProperty } from '@nestjs/swagger';
import { BarbersPageMetaDto } from './pagination.dto';

export class BarberDistanceDto {
  @ApiProperty({ example: 2.34, description: 'Distance in kilometers' })
  km: number;

  @ApiProperty({ example: 1.45, description: 'Distance in miles' })
  miles: number;
}

export class BarberTopServiceDto {
  @ApiProperty({ example: 'Skin Fade' })
  name: string;
}

export class BarberListItemDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) profileImage: string | null;
  @ApiProperty({ example: 4.8 }) averageRating: number;
  @ApiProperty({ example: 127 }) totalReviews: number;
  @ApiProperty({ type: BarberDistanceDto }) distance: BarberDistanceDto;
  @ApiProperty() recurringAvailable: boolean;
  @ApiProperty({ type: [BarberTopServiceDto] }) topServices: BarberTopServiceDto[];
}

export class ListBarbersResponseDto {
  @ApiProperty({ type: [BarberListItemDto] }) barbers: BarberListItemDto[];
  @ApiProperty({ type: BarbersPageMetaDto }) pagination: BarbersPageMetaDto;
}
