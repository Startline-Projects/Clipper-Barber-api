import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SupabaseUserPayload } from '../../supabase/supabase.service';
import { BarberServicesService } from './barber-services.service';
import { CreateBarberServiceDto } from './dto/create-barber-service.dto';
import { UpdateBarberServiceDto } from './dto/update-barber-service.dto';
import { ReorderBarberServicesDto } from './dto/reorder-barber-services.dto';
import {
  BarberServiceResponseDto,
  BarberServicesListResponseDto,
} from './dto/barber-service-response.dto';

@ApiTags('Barber Services')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('barber')
@Controller('barbers/:barberId/services')
export class BarberServicesController {
  constructor(private readonly barberServicesService: BarberServicesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new service for the barber' })
  @ApiBody({ type: CreateBarberServiceDto })
  @ApiResponse({ status: 201, description: 'Service created', type: BarberServiceResponseDto })
  public async createService(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('barberId', ParseUUIDPipe) barberId: string,
    @Body() dto: CreateBarberServiceDto
  ): Promise<BarberServiceResponseDto> {
    await this.barberServicesService.resolveAndVerifyOwnership(user.sub, barberId);
    const data = await this.barberServicesService.create(barberId, dto);
    return { success: true, data };
  }

  @Get()
  @ApiOperation({ summary: 'List all services for the barber (including inactive)' })
  @ApiResponse({ status: 200, description: 'Services listed', type: BarberServicesListResponseDto })
  public async listServices(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('barberId', ParseUUIDPipe) barberId: string
  ): Promise<BarberServicesListResponseDto> {
    await this.barberServicesService.resolveAndVerifyOwnership(user.sub, barberId);
    const data = await this.barberServicesService.findAll(barberId);
    return { success: true, data };
  }

  @Get(':serviceId')
  @ApiOperation({ summary: 'Get a single service by ID' })
  @ApiResponse({ status: 200, description: 'Service found', type: BarberServiceResponseDto })
  public async getService(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('barberId', ParseUUIDPipe) barberId: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string
  ): Promise<BarberServiceResponseDto> {
    await this.barberServicesService.resolveAndVerifyOwnership(user.sub, barberId);
    const data = await this.barberServicesService.findOne(barberId, serviceId);
    return { success: true, data };
  }

  @Patch('reorder')
  @ApiOperation({ summary: 'Bulk update sort_order by providing an ordered array of service IDs' })
  @ApiBody({ type: ReorderBarberServicesDto })
  @ApiResponse({
    status: 200,
    description: 'Services reordered',
    type: BarberServicesListResponseDto,
  })
  public async reorderServices(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('barberId', ParseUUIDPipe) barberId: string,
    @Body() dto: ReorderBarberServicesDto
  ): Promise<BarberServicesListResponseDto> {
    await this.barberServicesService.resolveAndVerifyOwnership(user.sub, barberId);
    const data = await this.barberServicesService.reorder(barberId, dto);
    return { success: true, data };
  }

  @Patch(':serviceId/toggle')
  @ApiOperation({ summary: 'Toggle is_active on/off for a service' })
  @ApiResponse({ status: 200, description: 'Service toggled', type: BarberServiceResponseDto })
  public async toggleService(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('barberId', ParseUUIDPipe) barberId: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string
  ): Promise<BarberServiceResponseDto> {
    await this.barberServicesService.resolveAndVerifyOwnership(user.sub, barberId);
    const data = await this.barberServicesService.toggle(barberId, serviceId);
    return { success: true, data };
  }

  @Patch(':serviceId')
  @ApiOperation({ summary: 'Update service fields (partial)' })
  @ApiBody({ type: UpdateBarberServiceDto })
  @ApiResponse({ status: 200, description: 'Service updated', type: BarberServiceResponseDto })
  public async updateService(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('barberId', ParseUUIDPipe) barberId: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body() dto: UpdateBarberServiceDto
  ): Promise<BarberServiceResponseDto> {
    await this.barberServicesService.resolveAndVerifyOwnership(user.sub, barberId);
    const data = await this.barberServicesService.update(barberId, serviceId, dto);
    return { success: true, data };
  }
}
