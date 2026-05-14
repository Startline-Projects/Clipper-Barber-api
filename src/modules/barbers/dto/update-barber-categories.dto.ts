import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsEnum, IsOptional } from 'class-validator';
import { BarberCategoryTag } from '../../../common/enums/barber-category-tag.enum';

/**
 * Edit the authenticated barber's category/specialty tags.
 *
 * The supplied array fully replaces the current selection (add / remove /
 * edit the whole set in one call). Omitting `categories` is a no-op;
 * sending `[]` clears all categories.
 */
export class UpdateBarberCategoriesDto {
  @ApiPropertyOptional({
    enum: BarberCategoryTag,
    isArray: true,
    example: [BarberCategoryTag.SKIN_FADES, BarberCategoryTag.CURLY_HAIR_SPECIALIST],
    description: 'Full replacement list of category/specialty tags.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(BarberCategoryTag, { each: true })
  categories?: BarberCategoryTag[];
}

export class BarberCategoriesResponseDto {
  @ApiProperty({ enum: BarberCategoryTag, isArray: true })
  categories: BarberCategoryTag[];
}
