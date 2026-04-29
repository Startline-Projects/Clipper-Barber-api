import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SupabaseUserPayload } from '../../supabase/supabase.service';
import { BarberHomeService } from './barber-home.service';
import { GetBarberHomeQueryDto } from './dto/get-barber-home-query.dto';
import { BarberHomeResponseDto } from './dto/barber-home-response.dto';

@ApiTags('Barber Home')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('barber')
@Controller('barber/home')
export class BarberHomeController {
  constructor(private readonly barberHomeService: BarberHomeService) {}

  @Get()
  @ApiOperation({
    summary:
      "Single-call home dashboard: today's counts and earnings, pending-approval queue, and the next confirmed appointments.",
  })
  @ApiResponse({ status: 200, type: BarberHomeResponseDto })
  public async getHome(
    @CurrentUser() user: SupabaseUserPayload,
    @Query() query: GetBarberHomeQueryDto
  ): Promise<BarberHomeResponseDto> {
    return this.barberHomeService.getHome(user.sub, query.tz);
  }
}
