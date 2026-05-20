import { Body, Controller, Get, Param, ParseEnumPipe, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseUserPayload } from '../supabase/supabase.service';
import { RemindersService } from './reminders.service';
import {
  ReminderSettingsResponseDto,
  ReminderTargetDto,
  UpdateReminderGroupDto,
} from './dto/reminder-settings.dto';

@ApiTags('Barber Reminder Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('barber')
@Controller('barber/reminder-settings')
export class BarberReminderSettingsController {
  constructor(private readonly remindersService: RemindersService) {}

  @Get()
  @ApiOperation({
    summary: 'Get the barber\'s client + self reminder settings (both groups).',
  })
  @ApiResponse({ status: 200, type: ReminderSettingsResponseDto })
  public async getSettings(
    @CurrentUser() user: SupabaseUserPayload,
  ): Promise<ReminderSettingsResponseDto> {
    return this.remindersService.getSettings(user.sub);
  }

  @Put(':target')
  @ApiOperation({
    summary:
      'Update one reminder group (client or self). Recomputes scheduled reminders for the barber\'s future bookings.',
  })
  @ApiParam({ name: 'target', enum: ReminderTargetDto })
  @ApiBody({ type: UpdateReminderGroupDto })
  @ApiResponse({ status: 200, type: ReminderSettingsResponseDto })
  public async updateGroup(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('target', new ParseEnumPipe(ReminderTargetDto)) target: ReminderTargetDto,
    @Body() dto: UpdateReminderGroupDto,
  ): Promise<ReminderSettingsResponseDto> {
    return this.remindersService.updateGroup(user.sub, target, dto);
  }
}
