import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SupabaseUserPayload } from '../../supabase/supabase.service';
import { BarberClientsService } from './barber-clients.service';
import { ListBarberClientsQueryDto } from './dto/list-barber-clients-query.dto';
import { ListBarberClientsResponseDto } from './dto/barber-client-list-item.dto';
import { GetBarberClientDetailQueryDto } from './dto/get-barber-client-detail-query.dto';
import { BarberClientDetailDto } from './dto/barber-client-detail.dto';

@ApiTags('Barber Clients')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('barber')
@Controller('barber/clients')
export class BarberClientsController {
  constructor(private readonly barberClientsService: BarberClientsService) {}

  @Get()
  @ApiOperation({
    summary: "List the authenticated barber's clients with stats, search, sort, and pagination",
  })
  @ApiResponse({ status: 200, type: ListBarberClientsResponseDto })
  public async listClients(
    @CurrentUser() user: SupabaseUserPayload,
    @Query() query: ListBarberClientsQueryDto
  ): Promise<ListBarberClientsResponseDto> {
    return this.barberClientsService.listClients(user.sub, query);
  }

  @Get(':clientId')
  @ApiOperation({
    summary:
      'Full detail for one client of the authenticated barber: profile, stats, bookings, recurring series',
  })
  @ApiResponse({ status: 200, type: BarberClientDetailDto })
  public async getClientDetail(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query() query: GetBarberClientDetailQueryDto
  ): Promise<BarberClientDetailDto> {
    return this.barberClientsService.getClientDetail(
      user.sub,
      clientId,
      query.pastPage,
      query.pastLimit
    );
  }
}
