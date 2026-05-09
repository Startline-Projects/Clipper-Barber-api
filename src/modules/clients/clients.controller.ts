import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseUserPayload } from '../supabase/supabase.service';
import {
  GetBarberDetailQueryDto,
  ListBarbersQueryDto,
} from './dto/list-barbers-query.dto';
import { ListBarbersResponseDto } from './dto/barber-list-item.dto';
import { BarberDetailResponseDto } from './dto/barber-detail-response.dto';

@ApiTags('Client Barbers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('client')
@Controller('client/barbers')
export class ClientBarbersController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List barbers for a client with filters (nearest/top-rated, recurring, search) and page-based pagination.',
  })
  @ApiResponse({ status: 200, type: ListBarbersResponseDto })
  public async listBarbers(
    @Query() query: ListBarbersQueryDto,
  ): Promise<ListBarbersResponseDto> {
    return this.clientsService.listBarbersForClient(query);
  }

  @Get(':barberId')
  @ApiOperation({
    summary:
      'Get full barber detail for a client: profile, services, last 7 reviews, review summary, distance.',
  })
  @ApiResponse({ status: 200, type: BarberDetailResponseDto })
  public async getBarberDetail(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('barberId', ParseUUIDPipe) barberId: string,
    @Query() query: GetBarberDetailQueryDto,
  ): Promise<BarberDetailResponseDto> {
    return this.clientsService.getBarberDetail(user.sub, barberId, query);
  }
}
