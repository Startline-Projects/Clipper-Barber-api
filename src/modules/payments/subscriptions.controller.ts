import { Body, Controller, Delete, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { SwitchPlanDto } from './dto/switch-plan.dto';
import {
  ActivePlanResponseDto,
  CancelSubscriptionResponseDto,
  CreateSubscriptionResponseDto,
  SubscriptionStateResponseDto,
} from './dto/subscription-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseUserPayload } from '../supabase/supabase.service';

@ApiTags('Subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('client')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a Stripe subscription for the authenticated client' })
  @ApiBody({ type: CreateSubscriptionDto })
  @ApiResponse({
    status: 201,
    description: 'Subscription created',
    type: CreateSubscriptionResponseDto,
  })
  public async createSubscription(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: CreateSubscriptionDto
  ): Promise<CreateSubscriptionResponseDto> {
    return this.subscriptionsService.createSubscription(user.sub, dto);
  }

  @Get('me')
  @HttpCode(200)
  @ApiOperation({ summary: "Return the authenticated client's subscription state" })
  @ApiResponse({ status: 200, type: SubscriptionStateResponseDto })
  public async getMySubscription(
    @CurrentUser() user: SupabaseUserPayload
  ): Promise<SubscriptionStateResponseDto> {
    return this.subscriptionsService.getSubscriptionState(user.sub);
  }

  @Get('me/active-plan')
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Return the authenticated client's active-plan flag plus a thin view of their current subscription. hasActivePlan is true iff subscription_status === 'active'.",
  })
  @ApiResponse({ status: 200, type: ActivePlanResponseDto })
  public async getActivePlan(
    @CurrentUser() user: SupabaseUserPayload
  ): Promise<ActivePlanResponseDto> {
    return this.subscriptionsService.getActivePlan(user.sub);
  }

  @Patch('me/plan')
  @HttpCode(200)
  @ApiOperation({ summary: 'Switch plan (monthly → yearly only). Returns 409 for downgrades.' })
  @ApiBody({ type: SwitchPlanDto })
  @ApiResponse({ status: 200, type: SubscriptionStateResponseDto })
  public async switchPlan(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: SwitchPlanDto
  ): Promise<SubscriptionStateResponseDto> {
    return this.subscriptionsService.switchPlan(user.sub, dto);
  }

  @Delete('me')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cancel the subscription at period end. No refunds, no mid-period termination.',
  })
  @ApiResponse({ status: 200, type: CancelSubscriptionResponseDto })
  public async cancelSubscription(
    @CurrentUser() user: SupabaseUserPayload
  ): Promise<CancelSubscriptionResponseDto> {
    return this.subscriptionsService.cancelSubscription(user.sub);
  }
}
