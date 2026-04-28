import { ApiProperty } from '@nestjs/swagger';

export class RatingBreakdownEntryDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  rating: number;

  @ApiProperty({ example: 5, description: 'Number of reviews with this rating' })
  count: number;

  @ApiProperty({
    example: 71,
    description: 'Whole-number percentage of total reviews. 0 when there are no reviews.',
  })
  percentage: number;
}

export class ReviewsAnalyticsResponseDto {
  @ApiProperty({ example: 7 })
  totalReviews: number;

  @ApiProperty({ example: 4.6, nullable: true, type: Number })
  averageRating: number | null;

  @ApiProperty({
    type: [RatingBreakdownEntryDto],
    description:
      'Breakdown by star rating, always 5 items in descending order (5 → 1). Counts and percentages are zero when no reviews exist for that rating.',
  })
  ratingsBreakdown: RatingBreakdownEntryDto[];
}
