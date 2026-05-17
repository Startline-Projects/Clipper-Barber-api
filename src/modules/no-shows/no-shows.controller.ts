import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { NoShowsService } from './no-shows.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseUserPayload } from '../supabase/supabase.service';
import {
  BarberNoShowStatsResponseDto,
  InitiateNoShowPaymentResponseDto,
  ListNoShowsQueryDto,
  ListNoShowsResponseDto,
  ReconcileNoShowResponseDto,
} from './dto/no-show.dto';

// ────────────────────────────────────────────────────────────
// Client side
// ────────────────────────────────────────────────────────────
@ApiTags('Client No-Shows')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('client')
@Controller('client/no-shows')
export class ClientNoShowsController {
  constructor(private readonly service: NoShowsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List the authenticated client’s no-shows. Unresolved/failed appear first (oldest first), then paid/refunded (newest first).',
  })
  @ApiResponse({ status: 200, type: ListNoShowsResponseDto })
  public async list(
    @CurrentUser() user: SupabaseUserPayload,
    @Query() query: ListNoShowsQueryDto
  ): Promise<ListNoShowsResponseDto> {
    return this.service.listForClient(user.sub, query);
  }

  @Post(':id/pay')
  @ApiOperation({
    summary:
      'Initiate Stripe payment for a single unresolved no-show. Returns a PaymentIntent client_secret to confirm with stripe-js / the mobile Payment Sheet. The no-show is marked paid only after the Stripe webhook confirms.',
  })
  @ApiResponse({ status: 200, type: InitiateNoShowPaymentResponseDto })
  public async pay(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<InitiateNoShowPaymentResponseDto> {
    return this.service.initiatePayment(user.sub, id);
  }

  @Post(':id/reconcile')
  @ApiOperation({
    summary:
      'Authoritative reconciliation against Stripe. Retrieves the PaymentIntent directly and applies its status to the no_shows row, self-healing webhook delivery failures. Safe to call repeatedly; idempotent on terminal states.',
  })
  @ApiResponse({ status: 200, type: ReconcileNoShowResponseDto })
  public async reconcile(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<ReconcileNoShowResponseDto> {
    return this.service.reconcile(user.sub, id);
  }
}

// ────────────────────────────────────────────────────────────
// Barber side
// ────────────────────────────────────────────────────────────
@ApiTags('Barber No-Shows')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('barber')
@Controller('barber/no-shows')
export class BarberNoShowsController {
  constructor(private readonly service: NoShowsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List no-shows incurred against the authenticated barber. Same ordering as the client list.',
  })
  @ApiResponse({ status: 200, type: ListNoShowsResponseDto })
  public async list(
    @CurrentUser() user: SupabaseUserPayload,
    @Query() query: ListNoShowsQueryDto
  ): Promise<ListNoShowsResponseDto> {
    return this.service.listForBarber(user.sub, query);
  }

  @Get('stats')
  @ApiOperation({
    summary:
      'Aggregate counts and amounts of unresolved vs resolved no-shows owed to / collected by the authenticated barber.',
  })
  @ApiResponse({ status: 200, type: BarberNoShowStatsResponseDto })
  public async stats(
    @CurrentUser() user: SupabaseUserPayload
  ): Promise<BarberNoShowStatsResponseDto> {
    const stats = await this.service.getBarberStats(user.sub);
    return { stats };
  }
}
