import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { CreateReviewResponseDto } from './dto/create-review-response.dto';
import { ListReviewsQueryDto } from './dto/list-reviews-query.dto';
import { ReviewsListResponseDto } from './dto/reviews-list-response.dto';
import { ReviewsAnalyticsResponseDto } from './dto/reviews-analytics-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseUserPayload } from '../supabase/supabase.service';

@ApiTags('Client Reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('client')
@Controller('client')
export class ClientReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post('bookings/:bookingId/review')
  @ApiOperation({ summary: 'Client creates a review for a completed booking they own' })
  @ApiBody({ type: CreateReviewDto })
  @ApiResponse({
    status: 201,
    description: 'Review created successfully',
    type: CreateReviewResponseDto,
  })
  public async createReview(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto: CreateReviewDto
  ): Promise<CreateReviewResponseDto> {
    return this.reviewsService.createReview(user.sub, bookingId, dto);
  }

  @Get('barbers/:barberId/reviews')
  @ApiOperation({
    summary:
      'Authenticated client views reviews for a barber — paginated, most recent first. Optionally filter by exact star rating (1..5).',
  })
  @ApiResponse({
    status: 200,
    description: 'Reviews returned successfully',
    type: ReviewsListResponseDto,
  })
  public async listBarberReviews(
    @Param('barberId', ParseUUIDPipe) barberId: string,
    @Query() query: ListReviewsQueryDto
  ): Promise<ReviewsListResponseDto> {
    return this.reviewsService.listReviewsForBarber(barberId, query);
  }
}

@ApiTags('Barber Reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('barber')
@Controller('barber/reviews')
export class BarberReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Authenticated barber views their own reviews — paginated, most recent first. Optionally filter by exact star rating (1..5).',
  })
  @ApiResponse({
    status: 200,
    description: 'Reviews returned successfully',
    type: ReviewsListResponseDto,
  })
  public async listOwnReviews(
    @CurrentUser() user: SupabaseUserPayload,
    @Query() query: ListReviewsQueryDto
  ): Promise<ReviewsListResponseDto> {
    return this.reviewsService.listReviewsForBarber(user.sub, query);
  }

  @Get('analytics')
  @ApiOperation({
    summary:
      "Reviews analytics for the authenticated barber — totals, average, and per-star (1..5) count + percentage.",
  })
  @ApiResponse({
    status: 200,
    description: 'Analytics returned successfully',
    type: ReviewsAnalyticsResponseDto,
  })
  public async getOwnAnalytics(
    @CurrentUser() user: SupabaseUserPayload
  ): Promise<ReviewsAnalyticsResponseDto> {
    return this.reviewsService.getAnalyticsForBarber(user.sub);
  }
}
