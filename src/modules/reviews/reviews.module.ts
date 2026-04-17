import { Module } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { BarberReviewsController, ClientReviewsController } from './reviews.controller';

@Module({
  controllers: [ClientReviewsController, BarberReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
