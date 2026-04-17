import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BarbersService } from './barbers.service';
import { AvailabilityService } from '../bookings/availability.service';
import { GetAvailabilityQueryDto } from '../bookings/dto/get-availability-query.dto';
import { AvailabilityResponseDto } from '../bookings/dto/availability-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseUserPayload } from '../supabase/supabase.service';
import { ListBarberBookingsQueryDto } from './dto/list-barber-bookings-query.dto';
import { BarberBookingsListResponseDto } from './dto/barber-booking-list-item.dto';
import { BarberBookingDetailResponseDto } from './dto/barber-booking-detail.dto';
import { ConfirmBarberBookingResponseDto } from './dto/confirm-booking-response.dto';
import { CancelBarberBookingResponseDto } from './dto/cancel-barber-booking-response.dto';
import { CompleteBookingResponseDto } from './dto/complete-booking-response.dto';
import { NoShowBookingResponseDto } from './dto/no-show-response.dto';
import { UpdateAutoConfirmDto } from './dto/update-auto-confirm.dto';
import { AutoConfirmSettingsResponseDto } from './dto/auto-confirm-settings-response.dto';

@ApiTags('Barbers')
@Controller('barbers')
export class BarbersController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get(':barberId/availability')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('client')
  @ApiOperation({ summary: 'Get available booking slots for a barber across all booking types' })
  @ApiResponse({ status: 200, description: 'Availability returned successfully' })
  public async getAvailability(
    @Param('barberId', ParseUUIDPipe) barberId: string,
    @Query() query: GetAvailabilityQueryDto
  ): Promise<AvailabilityResponseDto> {
    return this.availabilityService.getAvailability(barberId, query);
  }
}

@ApiTags('Barber Bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('barber')
@Controller('barber/bookings')
export class BarberBookingsController {
  constructor(private readonly barbersService: BarbersService) {}

  @Get()
  @ApiOperation({ summary: 'List barber bookings (upcoming/past) with filters + cursor pagination' })
  @ApiResponse({ status: 200, type: BarberBookingsListResponseDto })
  public async listBookings(
    @CurrentUser() user: SupabaseUserPayload,
    @Query() query: ListBarberBookingsQueryDto
  ): Promise<BarberBookingsListResponseDto> {
    return this.barbersService.listBookings(user.sub, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single booking with full pricing breakdown' })
  @ApiResponse({ status: 200, type: BarberBookingDetailResponseDto })
  public async getBooking(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<BarberBookingDetailResponseDto> {
    return this.barbersService.getBookingDetail(user.sub, id);
  }

  @Patch(':id/confirm')
  @ApiOperation({ summary: 'Barber manually confirms a pending booking' })
  @ApiResponse({ status: 200, type: ConfirmBarberBookingResponseDto })
  public async confirmBooking(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<ConfirmBarberBookingResponseDto> {
    return this.barbersService.confirmBooking(user.sub, id);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Barber cancels any pending or confirmed booking' })
  @ApiResponse({ status: 200, type: CancelBarberBookingResponseDto })
  public async cancelBooking(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<CancelBarberBookingResponseDto> {
    return this.barbersService.cancelBooking(user.sub, id);
  }

  @Patch(':id/complete')
  @ApiOperation({ summary: 'Barber manually marks a confirmed booking as completed' })
  @ApiResponse({ status: 200, type: CompleteBookingResponseDto })
  public async completeBooking(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<CompleteBookingResponseDto> {
    return this.barbersService.completeBookingManual(user.sub, id);
  }

  @Patch(':id/no-show')
  @ApiOperation({ summary: 'Barber marks a booking as no-show after the appointment window ends' })
  @ApiResponse({ status: 200, type: NoShowBookingResponseDto })
  public async markNoShow(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<NoShowBookingResponseDto> {
    return this.barbersService.markNoShow(user.sub, id);
  }
}

@ApiTags('Barber Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('barber')
@Controller('barber/settings')
export class BarberSettingsController {
  constructor(private readonly barbersService: BarbersService) {}

  @Patch('auto-confirm')
  @ApiOperation({ summary: 'Toggle global auto-confirm for all incoming bookings' })
  @ApiBody({ type: UpdateAutoConfirmDto })
  @ApiResponse({ status: 200, type: AutoConfirmSettingsResponseDto })
  public async updateAutoConfirm(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: UpdateAutoConfirmDto
  ): Promise<AutoConfirmSettingsResponseDto> {
    return this.barbersService.updateAllowAutoConfirm(user.sub, dto.enabled);
  }

  @Patch('auto-confirm-today')
  @ApiOperation({ summary: 'Toggle auto-confirm for same-day bookings only' })
  @ApiBody({ type: UpdateAutoConfirmDto })
  @ApiResponse({ status: 200, type: AutoConfirmSettingsResponseDto })
  public async updateAutoConfirmToday(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: UpdateAutoConfirmDto
  ): Promise<AutoConfirmSettingsResponseDto> {
    return this.barbersService.updateAutoConfirmToday(user.sub, dto.enabled);
  }
}
