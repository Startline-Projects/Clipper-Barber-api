import { Body, Controller, Delete, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CardsService } from './cards.service';
import { ReplaceCardDto, CardActionResponseDto } from './dto/replace-card.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SupabaseUserPayload } from '../supabase/supabase.service';

@ApiTags('Subscriptions — Cards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('client')
@Controller('subscriptions/me/payment-method')
export class CardsController {
  constructor(private readonly cardsService: CardsService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Replace the saved card. Old card is detached from Stripe.' })
  @ApiBody({ type: ReplaceCardDto })
  @ApiResponse({ status: 200, type: CardActionResponseDto })
  public async replaceCard(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: ReplaceCardDto
  ): Promise<CardActionResponseDto> {
    return this.cardsService.replaceCard(user.sub, dto);
  }

  @Delete()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Remove the saved card. 409 if an active subscription or recurring arrangement exists.',
  })
  @ApiResponse({ status: 200, type: CardActionResponseDto })
  public async removeCard(
    @CurrentUser() user: SupabaseUserPayload
  ): Promise<CardActionResponseDto> {
    return this.cardsService.removeCard(user.sub);
  }
}
