import { Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConnectService } from './connect.service';
import {
  ConnectDisconnectResponseDto,
  ConnectOnboardResponseDto,
  ConnectStatusResponseDto,
} from './dto/connect-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseUserPayload } from '../supabase/supabase.service';

@ApiTags('Barber — Connect')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('barber')
@Controller('barbers/me/connect')
export class ConnectController {
  constructor(private readonly connectService: ConnectService) {}

  @Post('onboard')
  @ApiOperation({ summary: 'Begin or continue Stripe Connect Express onboarding.' })
  @ApiResponse({ status: 201, type: ConnectOnboardResponseDto })
  public async onboard(
    @CurrentUser() user: SupabaseUserPayload
  ): Promise<ConnectOnboardResponseDto> {
    return this.connectService.onboard(user);
  }

  @Get('status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Return Connect account capabilities.' })
  @ApiResponse({ status: 200, type: ConnectStatusResponseDto })
  public async getStatus(
    @CurrentUser() user: SupabaseUserPayload
  ): Promise<ConnectStatusResponseDto> {
    return this.connectService.getStatus(user.sub);
  }

  @Delete()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Delete the Express Connect account. Forces no_show_charge_enabled to false.',
  })
  @ApiResponse({ status: 200, type: ConnectDisconnectResponseDto })
  public async disconnect(
    @CurrentUser() user: SupabaseUserPayload
  ): Promise<ConnectDisconnectResponseDto> {
    return this.connectService.disconnect(user.sub);
  }
}
