import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsEnum, IsOptional } from 'class-validator';
import { BarberCategoryTag } from '../../../common/enums/barber-category-tag.enum';

/**
 * Barber signup step 4 — categories / tags (OPTIONAL).
 *
 * The whole step can be skipped: omitting `categories` (or sending an empty
 * array) leaves the barber with no categories. When provided, every entry
 * must be a valid {@link BarberCategoryTag} and duplicates are rejected.
 */
export class BarberSignupCategoriesDto {
  @ApiPropertyOptional({
    enum: BarberCategoryTag,
    isArray: true,
    example: [BarberCategoryTag.SKIN_FADES, BarberCategoryTag.BEARD_SPECIALIST],
    description:
      'Optional multi-select list of category/specialty tags. Skip the step by omitting this field.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(BarberCategoryTag, { each: true })
  categories?: BarberCategoryTag[];
}
