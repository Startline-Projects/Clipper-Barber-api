import { ApiProperty } from '@nestjs/swagger';

export class CreatedReviewDto {
  @ApiProperty() id: string;
  @ApiProperty() bookingId: string;
  @ApiProperty() rating: number;
  @ApiProperty({ nullable: true, type: String }) comment: string | null;
  @ApiProperty() createdAt: string;
}

export class CreateReviewResponseDto {
  @ApiProperty({ type: CreatedReviewDto }) review: CreatedReviewDto;
}
