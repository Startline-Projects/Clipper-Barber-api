import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BarberCategoryTag } from '../../../common/enums/barber-category-tag.enum';

export enum BarberSortDto {
  NEAREST = 'nearest',
  TOP_RATED = 'top_rated',
}

export enum RecurringFilterDto {
  AVAILABLE = 'available',
  NOT_AVAILABLE = 'not_available',
}

export class ListBarbersQueryDto {
  @ApiProperty({ example: 40.7128, description: "Client's current latitude" })
  @Type(() => Number)
  @IsLatitude()
  latitude: number;

  @ApiProperty({ example: -74.006, description: "Client's current longitude" })
  @Type(() => Number)
  @IsLongitude()
  longitude: number;

  @ApiPropertyOptional({ enum: BarberSortDto, default: BarberSortDto.NEAREST })
  @IsOptional()
  @IsEnum(BarberSortDto)
  sort?: BarberSortDto;

  @ApiPropertyOptional({ enum: RecurringFilterDto })
  @IsOptional()
  @IsEnum(RecurringFilterDto)
  recurring?: RecurringFilterDto;

  @ApiPropertyOptional({ description: 'Search by barber name or service name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    enum: BarberCategoryTag,
    isArray: true,
    description:
      'Filter by one or more category/specialty tags. Accepts a comma-separated list (?categories=SKIN_FADES,BRAIDS) or repeated params. Returns barbers matching ANY of the selected categories.',
    example: [BarberCategoryTag.SKIN_FADES, BarberCategoryTag.BRAIDS],
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    const raw = Array.isArray(value) ? value : String(value).split(',');
    const cleaned = raw.map((v) => String(v).trim()).filter((v) => v.length > 0);
    return cleaned.length > 0 ? cleaned : undefined;
  })
  @IsArray()
  @ArrayUnique()
  @IsEnum(BarberCategoryTag, { each: true })
  categories?: BarberCategoryTag[];

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class GetBarberDetailQueryDto {
  @ApiProperty({ example: 40.7128, description: "Client's current latitude" })
  @Type(() => Number)
  @IsLatitude()
  latitude: number;

  @ApiProperty({ example: -74.006, description: "Client's current longitude" })
  @Type(() => Number)
  @IsLongitude()
  longitude: number;
}
