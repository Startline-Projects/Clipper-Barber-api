import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SupabaseUserPayload } from '../../supabase/supabase.service';
import { SubscriptionRequiredGuard } from '../../payments/guards/subscription-required.guard';
import { RecurringBookingsService } from './recurring.service';
import { GetRecurringSlotsQueryDto } from './dto/get-recurring-slots-query.dto';
import { RecurringSlotsResponseDto } from './dto/recurring-slots-response.dto';
import { CreateRecurringBookingDto } from './dto/create-recurring-booking.dto';
import { CreateBarberRecurringBookingDto } from './dto/create-barber-recurring-booking.dto';
import { DeclineRecurringBookingDto } from './dto/decline-recurring-booking.dto';
import { PauseRecurringBookingDto } from './dto/pause-recurring-booking.dto';
import { RecurringBookingResponseDto } from './dto/recurring-booking.dto';
import { RecurringBookingDetailResponseDto } from './dto/recurring-booking-detail.dto';
import { ListRecurringBookingsQueryDto } from './dto/list-recurring-bookings-query.dto';
import { RecurringBookingsListResponseDto } from './dto/recurring-booking-list.dto';

@ApiTags('Client Recurring Bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('client')
@Controller('client/recurring-bookings')
export class ClientRecurringBookingsController {
  constructor(protected readonly recurringService: RecurringBookingsService) {}

  @Get()
  @ApiOperation({
    summary: "List the authenticated client's recurring bookings with cursor pagination.",
  })
  @ApiResponse({ status: 200, type: RecurringBookingsListResponseDto })
  public async listRecurringBookings(
    @CurrentUser() user: SupabaseUserPayload,
    @Query() query: ListRecurringBookingsQueryDto
  ): Promise<RecurringBookingsListResponseDto> {
    return this.recurringService.listRecurringBookingsForClient(user.sub, query);
  }

  @Post()
  @UseGuards(SubscriptionRequiredGuard)
  @ApiOperation({
    summary:
      'Submit a recurring booking request to the barber. No appointment rows are created until the barber accepts.',
  })
  @ApiBody({ type: CreateRecurringBookingDto })
  @ApiResponse({ status: 201, type: RecurringBookingResponseDto })
  public async createRecurringBooking(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: CreateRecurringBookingDto
  ): Promise<RecurringBookingResponseDto> {
    return this.recurringService.createRecurringBooking(user.sub, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      "Get a client's recurring booking with past occurrences and all upcoming generated occurrences.",
  })
  @ApiResponse({ status: 200, type: RecurringBookingDetailResponseDto })
  public async getRecurringBooking(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<RecurringBookingDetailResponseDto> {
    return this.recurringService.getRecurringBookingForClient(user.sub, id);
  }

  @Patch(':id/pause')
  @ApiOperation({
    summary: 'Client pauses their recurring booking for a date range or indefinitely.',
  })
  @ApiBody({ type: PauseRecurringBookingDto })
  @ApiResponse({ status: 200, type: RecurringBookingResponseDto })
  public async pause(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PauseRecurringBookingDto
  ): Promise<RecurringBookingResponseDto> {
    return this.recurringService.pauseRecurringBooking(user.sub, 'client', id, dto);
  }

  @Patch(':id/resume')
  @ApiOperation({ summary: 'Client resumes a paused recurring booking and re-fills the window.' })
  @ApiResponse({ status: 200, type: RecurringBookingResponseDto })
  public async resume(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<RecurringBookingResponseDto> {
    return this.recurringService.resumeRecurringBooking(user.sub, 'client', id);
  }

  @Patch(':id/cancel')
  @ApiOperation({
    summary:
      'Client cancels a recurring booking. Future booking rows are cancelled; past/completed rows are preserved.',
  })
  @ApiResponse({ status: 200, type: RecurringBookingResponseDto })
  public async cancel(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<RecurringBookingResponseDto> {
    return this.recurringService.cancelRecurringBooking(user.sub, 'client', id);
  }

  @Post(':id/renew')
  @ApiOperation({
    summary:
      'Create a renewal of a recurring booking. Settings copy from the original; price re-snapshots at current rates; requires fresh barber acceptance.',
  })
  @ApiResponse({ status: 201, type: RecurringBookingResponseDto })
  public async renew(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<RecurringBookingResponseDto> {
    return this.recurringService.renewRecurringBooking(user.sub, id);
  }
}

@ApiTags('Client Recurring Bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('client')
@Controller('client/barbers/:barberId')
export class ClientRecurringSlotsController {
  constructor(protected readonly recurringService: RecurringBookingsService) {}

  @Get('recurring-slots')
  @UseGuards(SubscriptionRequiredGuard)
  @ApiOperation({
    summary:
      'List recurring-eligible slot times for a given barber/service/day, plus the exact recurring price and allowed frequencies. Returns recurringAvailable=false when the day does not support recurring — no error is thrown.',
  })
  @ApiResponse({ status: 200, type: RecurringSlotsResponseDto })
  public async getRecurringSlots(
    @Param('barberId', ParseUUIDPipe) barberId: string,
    @Query() query: GetRecurringSlotsQueryDto
  ): Promise<RecurringSlotsResponseDto> {
    return this.recurringService.getRecurringSlots(barberId, query.serviceIds, query.dayOfWeek);
  }
}

@ApiTags('Barber Recurring Bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('barber')
@Controller('barber/recurring-bookings')
export class BarberRecurringBookingsController {
  constructor(protected readonly recurringService: RecurringBookingsService) {}

  @Get()
  @ApiOperation({
    summary:
      "List the authenticated barber's recurring bookings. Pending offers appear here with status=pending_barber_approval.",
  })
  @ApiResponse({ status: 200, type: RecurringBookingsListResponseDto })
  public async listRecurringBookings(
    @CurrentUser() user: SupabaseUserPayload,
    @Query() query: ListRecurringBookingsQueryDto
  ): Promise<RecurringBookingsListResponseDto> {
    return this.recurringService.listRecurringBookingsForBarber(user.sub, query);
  }

  @Post()
  @ApiOperation({
    summary:
      "Barber creates a recurring booking on a client's behalf. Auto-accepted: status starts as 'active' and the 60-day window is generated synchronously.",
  })
  @ApiBody({ type: CreateBarberRecurringBookingDto })
  @ApiResponse({ status: 201, type: RecurringBookingResponseDto })
  public async createForClient(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: CreateBarberRecurringBookingDto
  ): Promise<RecurringBookingResponseDto> {
    return this.recurringService.createRecurringByBarber(user.sub, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Get a recurring booking (barber view) with past occurrences and all upcoming generated occurrences.',
  })
  @ApiResponse({ status: 200, type: RecurringBookingDetailResponseDto })
  public async getRecurringBooking(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<RecurringBookingDetailResponseDto> {
    return this.recurringService.getRecurringBookingForBarber(user.sub, id);
  }

  @Patch(':id/accept')
  @ApiOperation({
    summary:
      'Accept a pending recurring offer. Generates the 60-day window of confirmed bookings synchronously.',
  })
  @ApiResponse({ status: 200, type: RecurringBookingResponseDto })
  public async accept(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<RecurringBookingResponseDto> {
    return this.recurringService.acceptRecurringBooking(user.sub, id);
  }

  @Patch(':id/decline')
  @ApiOperation({ summary: 'Decline a pending recurring offer (optional reason).' })
  @ApiBody({ type: DeclineRecurringBookingDto })
  @ApiResponse({ status: 200, type: RecurringBookingResponseDto })
  public async decline(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineRecurringBookingDto
  ): Promise<RecurringBookingResponseDto> {
    return this.recurringService.declineRecurringBooking(user.sub, id, dto);
  }

  @Patch(':id/pause')
  @ApiOperation({ summary: 'Barber pauses a recurring booking for a date range or indefinitely.' })
  @ApiBody({ type: PauseRecurringBookingDto })
  @ApiResponse({ status: 200, type: RecurringBookingResponseDto })
  public async pause(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PauseRecurringBookingDto
  ): Promise<RecurringBookingResponseDto> {
    return this.recurringService.pauseRecurringBooking(user.sub, 'barber', id, dto);
  }

  @Patch(':id/resume')
  @ApiOperation({ summary: 'Barber resumes a paused recurring booking and re-fills the window.' })
  @ApiResponse({ status: 200, type: RecurringBookingResponseDto })
  public async resume(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<RecurringBookingResponseDto> {
    return this.recurringService.resumeRecurringBooking(user.sub, 'barber', id);
  }

  @Patch(':id/cancel')
  @ApiOperation({
    summary:
      'Barber cancels a recurring booking. Future booking rows are cancelled; past/completed rows are preserved.',
  })
  @ApiResponse({ status: 200, type: RecurringBookingResponseDto })
  public async cancel(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<RecurringBookingResponseDto> {
    return this.recurringService.cancelRecurringBooking(user.sub, 'barber', id);
  }
}

@ApiTags('Barber Recurring Bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('barber')
@Controller('barber/recurring-slots')
export class BarberRecurringSlotsController {
  constructor(protected readonly recurringService: RecurringBookingsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List recurring-eligible slot times for the authenticated barber on a given day-of-week, including availability against existing recurring and one-off bookings, plus allowed frequencies and the recurring price.',
  })
  @ApiResponse({ status: 200, type: RecurringSlotsResponseDto })
  public async getRecurringSlots(
    @CurrentUser() user: SupabaseUserPayload,
    @Query() query: GetRecurringSlotsQueryDto
  ): Promise<RecurringSlotsResponseDto> {
    return this.recurringService.getRecurringSlots(user.sub, query.serviceIds, query.dayOfWeek);
  }
}
