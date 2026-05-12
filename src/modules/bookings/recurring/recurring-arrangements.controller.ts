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
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SupabaseUserPayload } from '../../supabase/supabase.service';
import { RecurringArrangementsService } from './recurring-arrangements.service';
import { CreateRecurringArrangementDto } from './dto/create-recurring-arrangement.dto';
import {
  ListRecurringArrangementsQueryDto,
  RecurringArrangementStatusFilter,
} from './dto/list-recurring-arrangements-query.dto';
import { RejectRecurringArrangementDto } from './dto/reject-recurring-arrangement.dto';
import {
  RecurringArrangementResponseDto,
  RecurringArrangementsListResponseDto,
} from './dto/recurring-arrangement.dto';

@ApiTags('Barber Recurring Arrangements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('barber')
@Controller('barber/recurring-arrangements')
export class BarberRecurringArrangementsController {
  constructor(private readonly service: RecurringArrangementsService) {}

  @Post()
  @ApiOperation({
    summary:
      'Barber offers a recurring arrangement to one of their clients. 409 with structured conflict list if the next 8 weeks of would-be occurrences collide with existing calendar.',
  })
  @ApiBody({ type: CreateRecurringArrangementDto })
  @ApiResponse({ status: 201, type: RecurringArrangementResponseDto })
  public async create(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: CreateRecurringArrangementDto,
  ): Promise<RecurringArrangementResponseDto> {
    return this.service.createArrangement(user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List arrangements created by the authenticated barber.' })
  @ApiResponse({ status: 200, type: RecurringArrangementsListResponseDto })
  public async list(
    @CurrentUser() user: SupabaseUserPayload,
    @Query() query: ListRecurringArrangementsQueryDto,
  ): Promise<RecurringArrangementsListResponseDto> {
    return this.service.listForBarber(user.sub, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single arrangement (barber view).' })
  @ApiResponse({ status: 200, type: RecurringArrangementResponseDto })
  public async getOne(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RecurringArrangementResponseDto> {
    return this.service.getForBarber(user.sub, id);
  }

  @Patch(':id/cancel')
  @ApiOperation({
    summary:
      'Barber cancels their own offer. Allowed only while status = pending_client_approval.',
  })
  @ApiResponse({ status: 200, type: RecurringArrangementResponseDto })
  public async cancel(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RecurringArrangementResponseDto> {
    return this.service.barberCancel(user.sub, id);
  }

  @Patch(':id/end')
  @ApiOperation({
    summary:
      'Barber ends an active arrangement. Stops top-up; previously generated future bookings are left intact.',
  })
  @ApiResponse({ status: 200, type: RecurringArrangementResponseDto })
  public async end(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RecurringArrangementResponseDto> {
    return this.service.barberEnd(user.sub, id);
  }
}

@ApiTags('Client Recurring Arrangements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('client')
@Controller('client/recurring-arrangements')
export class ClientRecurringArrangementsController {
  constructor(private readonly service: RecurringArrangementsService) {}

  @Get()
  @ApiOperation({
    summary:
      "List arrangements offered to the authenticated client. Default filter shows pending + active.",
  })
  @ApiResponse({ status: 200, type: RecurringArrangementsListResponseDto })
  public async list(
    @CurrentUser() user: SupabaseUserPayload,
    @Query() query: ListRecurringArrangementsQueryDto,
  ): Promise<RecurringArrangementsListResponseDto> {
    return this.service.listForClient(user.sub, query);
  }

  @Get('pending')
  @ApiOperation({
    summary:
      'List recurring arrangements proposed by a barber that are awaiting THIS client\'s approval (status = pending_client_approval). Convenience wrapper over the list endpoint — supports the same limit/cursor pagination.',
  })
  @ApiResponse({ status: 200, type: RecurringArrangementsListResponseDto })
  public async listPending(
    @CurrentUser() user: SupabaseUserPayload,
    @Query() query: ListRecurringArrangementsQueryDto,
  ): Promise<RecurringArrangementsListResponseDto> {
    return this.service.listForClient(user.sub, {
      ...query,
      status: RecurringArrangementStatusFilter.PENDING_CLIENT_APPROVAL,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single arrangement (client view).' })
  @ApiResponse({ status: 200, type: RecurringArrangementResponseDto })
  public async getOne(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RecurringArrangementResponseDto> {
    return this.service.getForClient(user.sub, id);
  }

  @Post(':id/accept')
  @ApiOperation({
    summary:
      "Client accepts the arrangement. Idempotent — calling on an already-accepted offer returns 200 with noChange=true.",
  })
  @ApiResponse({ status: 200, type: RecurringArrangementResponseDto })
  public async accept(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RecurringArrangementResponseDto> {
    return this.service.clientAccept(user.sub, id);
  }

  @Post(':id/reject')
  @ApiOperation({
    summary:
      'Client rejects the arrangement. Idempotent — calling on an already-rejected offer returns 200 with noChange=true.',
  })
  @ApiBody({ type: RejectRecurringArrangementDto })
  @ApiResponse({ status: 200, type: RecurringArrangementResponseDto })
  public async reject(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectRecurringArrangementDto,
  ): Promise<RecurringArrangementResponseDto> {
    return this.service.clientReject(user.sub, id, dto);
  }
}
