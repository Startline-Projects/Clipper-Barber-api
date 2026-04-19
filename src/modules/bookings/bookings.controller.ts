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
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { PreviewBookingDto } from './dto/preview-booking.dto';
import { PreviewBookingResponseDto } from './dto/preview-booking-response.dto';
import { ConfirmBookingResponseDto } from './dto/confirm-booking-response.dto';
import { CancelBookingResponseDto } from './dto/cancel-booking-response.dto';
import { ListClientBookingsQueryDto } from './dto/list-client-bookings-query.dto';
import { ClientBookingsListResponseDto } from './dto/client-booking-list-item.dto';
import { ClientBookingDetailResponseDto } from './dto/client-booking-detail.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseUserPayload } from '../supabase/supabase.service';

@ApiTags('Bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post('preview')
  @Roles('client')
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
}

@ApiTags('Client Bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('client')
@Controller('client/bookings')
export class ClientBookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  @ApiOperation({ summary: 'List the authenticated client’s bookings (upcoming/past) with cursor pagination' })
  @ApiResponse({
    status: 200,
    description: 'Bookings returned successfully',
    type: ClientBookingsListResponseDto,
  })
  public async listBookings(
    @CurrentUser() user: SupabaseUserPayload,
    @Query() query: ListClientBookingsQueryDto
  ): Promise<ClientBookingsListResponseDto> {
    return this.bookingsService.listClientBookings(user.sub, query);
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
