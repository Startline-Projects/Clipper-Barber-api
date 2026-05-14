import { ApiProperty } from '@nestjs/swagger';
import { BarbersPageMetaDto } from './pagination.dto';
import { BarberCategoryTag } from '../../../common/enums/barber-category-tag.enum';

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
  @ApiProperty({
    enum: BarberCategoryTag,
    isArray: true,
    description: 'Barber category/specialty tags. Empty array when none selected.',
    example: [BarberCategoryTag.SKIN_FADES, BarberCategoryTag.BEARD_SPECIALIST],
  })
  categories: BarberCategoryTag[];
  @ApiProperty({ type: [BarberTopServiceDto] }) topServices: BarberTopServiceDto[];
}

export class ListBarbersResponseDto {
  @ApiProperty({ type: [BarberListItemDto] }) barbers: BarberListItemDto[];
  @ApiProperty({ type: BarbersPageMetaDto }) pagination: BarbersPageMetaDto;
}
