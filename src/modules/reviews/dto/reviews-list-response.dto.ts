import { ApiProperty } from '@nestjs/swagger';

export class ReviewBarberSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: Number }) averageRating: number | null;
  @ApiProperty() totalReviews: number;
}

export class ReviewClientSummaryDto {
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) profilePhotoUrl: string | null;
}

export class ReviewListItemDto {
  @ApiProperty() id: string;
  @ApiProperty({ type: ReviewClientSummaryDto }) client: ReviewClientSummaryDto;
  @ApiProperty() rating: number;
  @ApiProperty({ nullable: true, type: String }) comment: string | null;
  @ApiProperty({ example: '6 months ago' }) relativeTime: string;
  @ApiProperty() createdAt: string;
}

export class ReviewsListResponseDto {
  @ApiProperty({ type: ReviewBarberSummaryDto }) barber: ReviewBarberSummaryDto;
  @ApiProperty({ type: [ReviewListItemDto] }) reviews: ReviewListItemDto[];
  @ApiProperty({ nullable: true, type: String }) nextCursor: string | null;
  @ApiProperty() hasMore: boolean;
}
