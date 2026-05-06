import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
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
import { ConversationsService } from './conversations.service';
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto';
import { ListConversationsResponseDto } from './dto/list-conversations-response.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { ListMessagesResponseDto } from './dto/list-messages-response.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SendMessageResponseDto } from './dto/send-message-response.dto';
import { StartConversationDto } from './dto/start-conversation.dto';
import { ConversationDetailResponseDto } from './dto/conversation-detail.dto';

@ApiTags('Conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('barber', 'client')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  @ApiOperation({
    summary:
      "Paginated list of the authenticated user's chat threads (barber or client), newest first.",
  })
  @ApiResponse({ status: 200, type: ListConversationsResponseDto })
  public async listConversations(
    @CurrentUser() user: SupabaseUserPayload,
    @Query() query: ListConversationsQueryDto,
  ): Promise<ListConversationsResponseDto> {
    return this.conversationsService.listConversations(
      user.sub,
      this.resolveRole(user),
      query,
    );
  }

  @Get(':id/messages')
  @ApiOperation({
    summary:
      'Cursor-paginated messages in a conversation. Marks counterparty messages as read.',
  })
  @ApiResponse({ status: 200, type: ListMessagesResponseDto })
  public async listMessages(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Query() query: ListMessagesQueryDto,
  ): Promise<ListMessagesResponseDto> {
    return this.conversationsService.listMessages(
      user.sub,
      this.resolveRole(user),
      conversationId,
      query,
    );
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Send a message in an existing conversation.' })
  @ApiBody({ type: SendMessageDto })
  @ApiResponse({ status: 201, type: SendMessageResponseDto })
  public async sendMessage(
    @CurrentUser() user: SupabaseUserPayload,
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Body() dto: SendMessageDto,
  ): Promise<SendMessageResponseDto> {
    return this.conversationsService.sendMessage(
      user.sub,
      this.resolveRole(user),
      conversationId,
      dto,
    );
  }

  @Post('start')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Start (or return existing) conversation with the other party. Barbers pass a client id; clients pass a barber id.',
  })
  @ApiBody({ type: StartConversationDto })
  @ApiResponse({ status: 200, type: ConversationDetailResponseDto })
  public async startConversation(
    @CurrentUser() user: SupabaseUserPayload,
    @Body() dto: StartConversationDto,
  ): Promise<ConversationDetailResponseDto> {
    return this.conversationsService.startConversation(
      user.sub,
      this.resolveRole(user),
      dto.otherUserId,
    );
  }

  private resolveRole(user: SupabaseUserPayload): 'barber' | 'client' {
    const role = user.user_metadata?.role;
    if (role !== 'barber' && role !== 'client') {
      throw new ForbiddenException('Unsupported account role for conversations');
    }
    return role;
  }
}
