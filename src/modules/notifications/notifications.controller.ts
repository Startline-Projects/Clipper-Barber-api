import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseUserPayload } from '../supabase/supabase.service';
import { NotificationsService, RecipientType } from './notifications.service';
import {
  RegisterDeviceTokenDto,
  RegisterDeviceTokenResponseDto,
} from './dto/register-device-token.dto';
import {
  RemoveDeviceTokenDto,
  RemoveDeviceTokenResponseDto,
} from './dto/remove-device-token.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import {
  ListNotificationsResponseDto,
  MarkNotificationReadResponseDto,
  UnreadCountResponseDto,
} from './dto/notification.dto';
import {
  NotificationSettingsResponseDto,
  UpdateNotificationSettingsDto,
} from './dto/notification-settings.dto';

// Shared device-token endpoints — any authenticated user (client or barber)
// registers their Expo push token here. user_type is derived from the JWT.
@ApiTags('Device Tokens')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('device-token')
export class DeviceTokenController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Register or refresh the caller\'s Expo push token for a given platform. Upserts on (user_id, platform).',
  })
  @ApiBody({ type: RegisterDeviceTokenDto })
  @ApiResponse({ status: 200, type: RegisterDeviceTokenResponseDto })
  public async registerDeviceToken(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: RegisterDeviceTokenDto,
  ): Promise<RegisterDeviceTokenResponseDto> {
    const userType = this.resolveUserType(user);
    return this.notificationsService.registerDeviceToken(user.sub, userType, dto);
  }

  @Delete()
  @ApiOperation({
    summary: "Remove a device token (call on logout). Only removes the caller's own token.",
  })
  @ApiBody({ type: RemoveDeviceTokenDto })
  @ApiResponse({ status: 200, type: RemoveDeviceTokenResponseDto })
  public async removeDeviceToken(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: RemoveDeviceTokenDto,
  ): Promise<RemoveDeviceTokenResponseDto> {
    return this.notificationsService.removeDeviceToken(user.sub, dto.token);
  }

  private resolveUserType(user: SupabaseUserPayload): RecipientType {
    const role = user.user_metadata?.role;
    if (role === 'barber' || role === 'client') return role;
    // Fallback to client — matches the default registration role
    return 'client';
  }
}

@ApiTags('Barber Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('barber')
@Controller('barber/notifications')
export class BarberNotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "Paginated list of the barber's notifications, newest first." })
  @ApiResponse({ status: 200, type: ListNotificationsResponseDto })
  public async listNotifications(
    @CurrentUser() user: SupabaseUserPayload,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<ListNotificationsResponseDto> {
    return this.notificationsService.listNotifications(
      user.sub,
      'barber',
      query.page,
      query.limit,
    );
  }

  @Get('unread-count')
  @ApiOperation({ summary: "Count of unread notifications for the barber." })
  @ApiResponse({ status: 200, type: UnreadCountResponseDto })
  public async getUnreadCount(
    @CurrentUser() user: SupabaseUserPayload,
  ): Promise<UnreadCountResponseDto> {
    return this.notificationsService.getUnreadCount(user.sub, 'barber');
  }

  @Put(':notificationId/read')
  @ApiOperation({ summary: 'Mark a barber notification as read.' })
  @ApiResponse({ status: 200, type: MarkNotificationReadResponseDto })
  public async markAsRead(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
  ): Promise<MarkNotificationReadResponseDto> {
    return this.notificationsService.markAsRead(user.sub, 'barber', notificationId);
  }
}

@ApiTags('Barber Notification Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('barber')
@Controller('barber/notification-settings')
export class BarberNotificationSettingsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get the barber notification preferences (normal_bookings, recurring_bookings).',
  })
  @ApiResponse({ status: 200, type: NotificationSettingsResponseDto })
  public async getSettings(
    @CurrentUser() user: SupabaseUserPayload,
  ): Promise<NotificationSettingsResponseDto> {
    return this.notificationsService.getBarberSettings(user.sub);
  }

  @Put()
  @ApiOperation({
    summary: 'Update the barber notification preferences (normal_bookings, recurring_bookings).',
  })
  @ApiBody({ type: UpdateNotificationSettingsDto })
  @ApiResponse({ status: 200, type: NotificationSettingsResponseDto })
  public async updateSettings(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: UpdateNotificationSettingsDto,
  ): Promise<NotificationSettingsResponseDto> {
    return this.notificationsService.updateBarberSettings(user.sub, dto);
  }
}

@ApiTags('Client Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('client')
@Controller('client/notifications')
export class ClientNotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "Paginated list of the client's notifications, newest first." })
  @ApiResponse({ status: 200, type: ListNotificationsResponseDto })
  public async listNotifications(
    @CurrentUser() user: SupabaseUserPayload,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<ListNotificationsResponseDto> {
    return this.notificationsService.listNotifications(
      user.sub,
      'client',
      query.page,
      query.limit,
    );
  }

  @Get('unread-count')
  @ApiOperation({ summary: "Count of unread notifications for the client." })
  @ApiResponse({ status: 200, type: UnreadCountResponseDto })
  public async getUnreadCount(
    @CurrentUser() user: SupabaseUserPayload,
  ): Promise<UnreadCountResponseDto> {
    return this.notificationsService.getUnreadCount(user.sub, 'client');
  }

  @Put(':notificationId/read')
  @ApiOperation({ summary: 'Mark a client notification as read.' })
  @ApiResponse({ status: 200, type: MarkNotificationReadResponseDto })
  public async markAsRead(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
  ): Promise<MarkNotificationReadResponseDto> {
    return this.notificationsService.markAsRead(user.sub, 'client', notificationId);
  }
}
