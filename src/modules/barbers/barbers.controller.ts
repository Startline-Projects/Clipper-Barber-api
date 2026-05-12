import 'multer';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BarbersService } from './barbers.service';
import { AvailabilityService } from '../bookings/availability.service';
import { GetAvailabilityQueryDto } from '../bookings/dto/get-availability-query.dto';
import { AvailabilityResponseDto } from '../bookings/dto/availability-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseUserPayload } from '../supabase/supabase.service';
import { SubscriptionRequiredGuard } from '../payments/guards/subscription-required.guard';
import { ListBarberBookingsQueryDto } from './dto/list-barber-bookings-query.dto';
import { BarberBookingsListResponseDto } from './dto/barber-booking-list-item.dto';
import { BarberBookingDetailResponseDto } from './dto/barber-booking-detail.dto';
import { ConfirmBarberBookingResponseDto } from './dto/confirm-booking-response.dto';
import { CancelBarberBookingResponseDto } from './dto/cancel-barber-booking-response.dto';
import { CompleteBookingResponseDto } from './dto/complete-booking-response.dto';
import { NoShowBookingResponseDto } from './dto/no-show-response.dto';
import { UpdateAutoConfirmDto } from './dto/update-auto-confirm.dto';
import { AutoConfirmSettingsResponseDto } from './dto/auto-confirm-settings-response.dto';
import {
  RecurringEnabledResponseDto,
  UpdateRecurringEnabledDto,
} from './dto/update-recurring-enabled.dto';
import {
  InHouseServicesResponseDto,
  UpdateInHouseServicesDto,
} from './dto/update-in-house-services.dto';
import {
  NoShowChargeSettingsResponseDto,
  UpdateNoShowChargeDto,
} from './dto/update-no-show-charge.dto';
import { UpdateBarberProfileDto } from './dto/update-barber-profile.dto';
import { BarberProfileResponseDto } from '../auth/dto/responses/barber-profile.response.dto';

@ApiTags('Barbers')
@Controller('barbers')
export class BarbersController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get(':barberId/availability')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard, SubscriptionRequiredGuard)
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
  @ApiOperation({
    summary: 'List barber bookings (upcoming/past) with filters + cursor pagination',
  })
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

@ApiTags('Barber Profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('barber')
@Controller('barber/profile')
export class BarberProfileController {
  constructor(private readonly barbersService: BarbersService) {}

  @Get()
  @ApiOperation({
    summary: 'Get the authenticated barber’s full profile',
  })
  @ApiResponse({ status: 200, type: BarberProfileResponseDto })
  public async getProfile(
    @CurrentUser() user: SupabaseUserPayload
  ): Promise<BarberProfileResponseDto> {
    return this.barbersService.getProfile(user.sub);
  }

  @Patch()
  @UseInterceptors(FileInterceptor('photo'))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({
    summary: 'Update the authenticated barber’s profile',
    description:
      'Any subset of fields may be supplied. Send as multipart/form-data when including a `photo` file; otherwise application/json works just as well.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        photo: {
          type: 'string',
          format: 'binary',
          description: 'Optional profile photo (max 5 MB)',
        },
        fullName: { type: 'string', maxLength: 100 },
        shopName: { type: 'string', maxLength: 100 },
        phone: { type: 'string' },
        streetAddress: { type: 'string', maxLength: 200 },
        city: { type: 'string', maxLength: 100 },
        state: { type: 'string', maxLength: 50 },
        zipCode: { type: 'string' },
        latitude: { type: 'number' },
        longitude: { type: 'number' },
        bio: { type: 'string', maxLength: 500 },
        instagramHandle: { type: 'string', maxLength: 50 },
      },
    },
  })
  @ApiResponse({ status: 200, type: BarberProfileResponseDto })
  public async updateProfile(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: UpdateBarberProfileDto,
    @UploadedFile() photo?: Express.Multer.File
  ): Promise<BarberProfileResponseDto> {
    return this.barbersService.updateProfile(user.sub, dto, photo);
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

  @Patch('recurring')
  @ApiOperation({
    summary:
      'Barber-level manual override for recurring availability. Auto-synced by schedule updates; this manual toggle overrides until the next schedule save.',
  })
  @ApiBody({ type: UpdateRecurringEnabledDto })
  @ApiResponse({ status: 200, type: RecurringEnabledResponseDto })
  public async updateRecurringEnabled(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: UpdateRecurringEnabledDto
  ): Promise<RecurringEnabledResponseDto> {
    return this.barbersService.updateRecurringEnabled(user.sub, dto.enabled);
  }

  @Patch('no-show-charge')
  @ApiOperation({
    summary:
      'Toggle the no-show charge feature and/or update its amount. Returns 409 CONNECT_REQUIRED if attempting to enable without a Connect account whose charges_enabled is true.',
  })
  @ApiBody({ type: UpdateNoShowChargeDto })
  @ApiResponse({ status: 200, type: NoShowChargeSettingsResponseDto })
  public async updateNoShowCharge(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: UpdateNoShowChargeDto
  ): Promise<NoShowChargeSettingsResponseDto> {
    return this.barbersService.updateNoShowChargeSettings(user.sub, dto);
  }

  @Patch('in-house-services')
  @ApiOperation({
    summary:
      'Toggle whether the barber offers in-house (on-premises) services. Persisted on barbers.in_house_services.',
  })
  @ApiBody({ type: UpdateInHouseServicesDto })
  @ApiResponse({ status: 200, type: InHouseServicesResponseDto })
  public async updateInHouseServices(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: UpdateInHouseServicesDto
  ): Promise<InHouseServicesResponseDto> {
    return this.barbersService.updateInHouseServices(user.sub, dto.enabled);
  }
}
