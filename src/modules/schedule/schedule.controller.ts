import { Body, Controller, Get, Param, ParseIntPipe, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EmailVerifiedGuard } from '../auth/guards/email-verified.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseUserPayload } from '../supabase/supabase.service';
import { ScheduleService } from './schedule.service';
import { UpdateScheduleDayDto } from './dto/update-schedule-day.dto';
import {
  ScheduleDayResponseDto,
  ScheduleListResponseDto,
} from './dto/schedule-day-response.dto';

@ApiTags('Schedule')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('barber')
@Controller('schedule')
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Get()
  @ApiOperation({ summary: 'Get all 7 schedule days for the authenticated barber' })
  @ApiResponse({ status: 200, description: 'Schedule retrieved', type: ScheduleListResponseDto })
  public async getSchedule(
    @CurrentUser() user: SupabaseUserPayload,
  ): Promise<ScheduleListResponseDto> {
    const data = await this.scheduleService.getSchedule(user.sub);
    return { success: true, data };
  }

  @Patch(':dayOfWeek')
  @UseGuards(EmailVerifiedGuard)
  @ApiOperation({ summary: 'Update a single schedule day (partial update)' })
  @ApiBody({ type: UpdateScheduleDayDto })
  @ApiResponse({ status: 200, description: 'Schedule day updated', type: ScheduleDayResponseDto })
  public async updateScheduleDay(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('dayOfWeek', ParseIntPipe) dayOfWeek: number,
    @Body() dto: UpdateScheduleDayDto,
  ): Promise<ScheduleDayResponseDto> {
    const data = await this.scheduleService.updateScheduleDay(user.sub, dayOfWeek, dto);
    return { success: true, data };
  }
}
