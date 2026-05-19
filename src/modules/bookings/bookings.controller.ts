import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { PreviewBookingDto } from './dto/preview-booking.dto';
import { PreviewBookingResponseDto } from './dto/preview-booking-response.dto';
import { ConfirmBookingResponseDto } from './dto/confirm-booking-response.dto';
import { CancelBookingResponseDto } from './dto/cancel-booking-response.dto';
import { ClientBookingsPageQueryDto } from './dto/client-bookings-page-query.dto';
import { ClientUpcomingBookingsResponseDto } from './dto/client-upcoming-booking.dto';
import { ClientPastBookingsResponseDto } from './dto/client-past-booking.dto';
import { ClientBookingDetailResponseDto } from './dto/client-booking-detail.dto';
import { ClientRecurringBookingsListResponseDto } from './recurring/dto/client-recurring-booking-list.dto';
import { RecurringBookingsService } from './recurring/recurring.service';
import { AnalyticsPeriodDto, AnalyticsQueryDto } from './dto/analytics-query.dto';
import { AnalyticsResponseDto } from './dto/analytics-response.dto';
// [EMAIL_VERIFICATION_DISABLED] Temporarily disabled — re-enable to require verified email before booking confirm.
// import { EmailVerifiedGuard } from '../auth/guards/email-verified.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseUserPayload } from '../supabase/supabase.service';
import { SubscriptionRequiredGuard } from '../payments/guards/subscription-required.guard';

@ApiTags('Bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post('preview')
  @Roles('client')
  // @UseGuards(SubscriptionRequiredGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Preview a booking with pricing breakdown — no row is created' })
  @ApiBody({ type: PreviewBookingDto })
  @ApiResponse({
    status: 200,
    description: 'Booking preview returned successfully',
    type: PreviewBookingResponseDto,
  })
  public async previewBooking(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: PreviewBookingDto
  ): Promise<PreviewBookingResponseDto> {
    return this.bookingsService.previewBooking(user.sub, dto);
  }

  @Post('confirm')
  @Roles('client')
  // [EMAIL_VERIFICATION_DISABLED] Temporarily disabled — re-enable to block unverified clients from confirming bookings.
  // @UseGuards(EmailVerifiedGuard)
  // @UseGuards(SubscriptionRequiredGuard)
  @ApiOperation({ summary: 'Confirm a previewed booking — inserts a booking row' })
  @ApiBody({ type: PreviewBookingDto })
  @ApiResponse({
    status: 201,
    description: 'Booking created successfully',
    type: ConfirmBookingResponseDto,
  })
  public async confirmBooking(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: PreviewBookingDto
  ): Promise<ConfirmBookingResponseDto> {
    return this.bookingsService.confirmBooking(user.sub, dto);
  }

  @Get('analytics')
  @Roles('barber')
  @ApiOperation({
    summary:
      'Earnings analytics for the authenticated barber over the chosen rolling window. Counts only completed bookings; no-show charges are excluded.',
  })
  @ApiQuery({ name: 'period', enum: AnalyticsPeriodDto, example: AnalyticsPeriodDto.WEEK })
  @ApiResponse({ status: 200, type: AnalyticsResponseDto })
  public async getAnalytics(
    @CurrentUser() user: SupabaseUserPayload,
    @Query() query: AnalyticsQueryDto
  ): Promise<AnalyticsResponseDto> {
    const result = await this.bookingsService.getAnalytics(user.sub, query.period);
    return result as unknown as AnalyticsResponseDto;
  }
}

@ApiTags('Client Bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('client')
@Controller('client/bookings')
export class ClientBookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly recurringService: RecurringBookingsService
  ) {}

  @Get('upcoming')
  @ApiOperation({
    summary:
      "List the authenticated client's upcoming bookings. Recurring subscriptions collapse to their next occurrence only.",
  })
  @ApiResponse({ status: 200, type: ClientUpcomingBookingsResponseDto })
  public async listUpcomingBookings(
    @CurrentUser() user: SupabaseUserPayload,
    @Query() query: ClientBookingsPageQueryDto
  ): Promise<ClientUpcomingBookingsResponseDto> {
    return this.bookingsService.listClientUpcomingBookings(user.sub, query);
  }

  @Get('past')
  @ApiOperation({
    summary: "List the authenticated client's completed bookings with review flag.",
  })
  @ApiResponse({ status: 200, type: ClientPastBookingsResponseDto })
  public async listPastBookings(
    @CurrentUser() user: SupabaseUserPayload,
    @Query() query: ClientBookingsPageQueryDto
  ): Promise<ClientPastBookingsResponseDto> {
    return this.bookingsService.listClientPastBookings(user.sub, query);
  }

  @Get('recurring')
  @ApiOperation({
    summary:
      "List the authenticated client's recurring subscriptions with status and remaining-appointments count.",
  })
  @ApiResponse({ status: 200, type: ClientRecurringBookingsListResponseDto })
  public async listRecurringBookings(
    @CurrentUser() user: SupabaseUserPayload,
    @Query() query: ClientBookingsPageQueryDto
  ): Promise<ClientRecurringBookingsListResponseDto> {
    return this.recurringService.listClientRecurringForClient(user.sub, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single booking (client view) with pricing breakdown and review' })
  @ApiResponse({
    status: 200,
    description: 'Booking detail returned successfully',
    type: ClientBookingDetailResponseDto,
  })
  public async getBooking(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<ClientBookingDetailResponseDto> {
    return this.bookingsService.getClientBookingDetail(user.sub, id);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Client cancels one of their own upcoming bookings' })
  @ApiResponse({
    status: 200,
    description: 'Booking cancelled successfully',
    type: CancelBookingResponseDto,
  })
  public async cancelBooking(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<CancelBookingResponseDto> {
    return this.bookingsService.cancelClientBooking(user.sub, id);
  }
}
