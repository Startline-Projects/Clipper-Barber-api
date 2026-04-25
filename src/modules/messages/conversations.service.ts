import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationTypeDto } from '../notifications/dto/notification.dto';
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto';
import {
  ConversationListItemDto,
  ConversationParticipantDto,
} from './dto/conversation-list-item.dto';
import { ListConversationsResponseDto } from './dto/list-conversations-response.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { ListMessagesResponseDto } from './dto/list-messages-response.dto';
import { MessageDto } from './dto/message.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SendMessageResponseDto } from './dto/send-message-response.dto';
import { ConversationDetailResponseDto } from './dto/conversation-detail.dto';

type SenderRole = 'barber' | 'client';

const DEFAULT_PAGE = 1;
const DEFAULT_CONVERSATIONS_LIMIT = 20;
const MAX_CONVERSATIONS_LIMIT = 100;
const DEFAULT_MESSAGES_LIMIT = 30;
const MAX_MESSAGES_LIMIT = 100;
const NON_BOOKING_STATUSES_EXCLUDED: readonly string[] = ['cancelled'];

interface ConversationRow {
  id: string;
  barber_id: string;
  client_id: string;
  last_message_body: string | null;
  last_message_at: string | null;
  last_message_sender_role: SenderRole | null;
  barber_unread_count: number;
  client_unread_count: number;
  has_booking: boolean;
  created_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  barber_id: string;
  client_id: string;
  sender_role: SenderRole;
  body: string;
  read_at: string | null;
  created_at: string;
}

interface BarberLookup {
  user_id: string;
  name: string;
  profile_photo_url: string | null;
}

interface ClientLookup {
  user_id: string;
  name: string;
  profile_photo_url: string | null;
}

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  // ────────────────────────────────────────────────────────────
  // Conversation list
  // ────────────────────────────────────────────────────────────

  public async listConversations(
    userId: string,
    role: SenderRole,
    query: ListConversationsQueryDto,
  ): Promise<ListConversationsResponseDto> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = Math.min(query.limit ?? DEFAULT_CONVERSATIONS_LIMIT, MAX_CONVERSATIONS_LIMIT);

    // Pre-resolve search matches against the OTHER party's display table
    // so we can push the filter down to conversations in a single query.
    const otherPartyIds = await this.resolveSearchOtherPartyIds(role, query.search);

    const rows = await this.fetchConversationsForUser(userId, role, otherPartyIds);

    const totalConversations = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalConversations / limit));
    const startIndex = (page - 1) * limit;
    const pageRows = rows.slice(startIndex, startIndex + limit);

    const otherIds = pageRows.map((r) => (role === 'barber' ? r.client_id : r.barber_id));
    const participants =
      role === 'barber'
        ? await this.fetchClientsByIds(otherIds)
        : await this.fetchBarbersByIds(otherIds);

    const conversations: ConversationListItemDto[] = pageRows.map((r) =>
      this.mapConversationListItem(r, role, participants),
    );

    return {
      conversations,
      pagination: {
        currentPage: page,
        totalPages,
        totalConversations,
        limit,
        hasNextPage: page < totalPages,
      },
    };
  }

  // ────────────────────────────────────────────────────────────
  // Messages within a conversation (cursor-paginated)
  // ────────────────────────────────────────────────────────────

  public async listMessages(
    userId: string,
    role: SenderRole,
    conversationId: string,
    query: ListMessagesQueryDto,
  ): Promise<ListMessagesResponseDto> {
    const conversation = await this.loadConversationForParticipant(conversationId, userId, role);

    const limit = Math.min(query.limit ?? DEFAULT_MESSAGES_LIMIT, MAX_MESSAGES_LIMIT);

    const cursor = query.before
      ? await this.resolveCursorCreatedAt(conversationId, query.before)
      : null;

    let q = this.db
      .from('messages')
      .select('id, conversation_id, barber_id, client_id, sender_role, body, read_at, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (cursor) {
      q = q.lt('created_at', cursor);
    }

    const { data, error } = await q;
    if (error) throw new InternalServerErrorException('Failed to fetch messages');

    const raw = (data ?? []) as MessageRow[];
    const hasMore = raw.length > limit;
    const page = hasMore ? raw.slice(0, limit) : raw;
    const ordered = [...page].reverse();

    // Side-effects: mark counterparty's unread messages as read + reset
    // this user's unread counter on the conversation. Errors here don't
    // fail the read — they're best-effort.
    await this.markConversationRead(conversation, role).catch((err) => {
      this.logger.warn(
        `Failed to mark conversation ${conversationId} as read: ${(err as Error).message}`,
      );
    });

    return {
      messages: ordered.map((r) => this.mapMessageRow(r)),
      hasMore,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  // ────────────────────────────────────────────────────────────
  // Send message
  // ────────────────────────────────────────────────────────────

  public async sendMessage(
    userId: string,
    role: SenderRole,
    conversationId: string,
    dto: SendMessageDto,
  ): Promise<SendMessageResponseDto> {
    const conversation = await this.loadConversationForParticipant(conversationId, userId, role);

    const nowIso = new Date().toISOString();

    const { data: inserted, error } = await this.db
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        barber_id: conversation.barber_id,
        client_id: conversation.client_id,
        sender_role: role,
        body: dto.body,
      })
      .select('id, conversation_id, barber_id, client_id, sender_role, body, read_at, created_at')
      .single();

    if (error || !inserted) {
      throw new InternalServerErrorException('Failed to send message');
    }

    const row = inserted as MessageRow;

    const updates: Record<string, unknown> = {
      last_message_body: row.body,
      last_message_at: row.created_at ?? nowIso,
      last_message_sender_role: role,
    };
    if (role === 'barber') {
      updates.client_unread_count = conversation.client_unread_count + 1;
    } else {
      updates.barber_unread_count = conversation.barber_unread_count + 1;
    }

    const { error: updateError } = await this.db
      .from('conversations')
      .update(updates)
      .eq('id', conversation.id);

    if (updateError) {
      this.logger.error(
        `Failed to update conversation ${conversation.id} counters: ${updateError.message}`,
      );
    }

    const recipientId = role === 'barber' ? conversation.client_id : conversation.barber_id;
    const recipientType = role === 'barber' ? 'client' : 'barber';

    void this.notificationsService.createAndSendNotification({
      recipientId,
      recipientType,
      senderId: userId,
      type: NotificationTypeDto.NEW_MESSAGE,
      conversationId: conversation.id,
      messageId: row.id,
      messageBody: row.body,
    });

    return { message: this.mapMessageRow(row) };
  }

  // ────────────────────────────────────────────────────────────
  // Barber-only: start a new conversation with a client
  // ────────────────────────────────────────────────────────────

  public async startConversation(
    barberId: string,
    clientId: string,
  ): Promise<ConversationDetailResponseDto> {
    if (barberId === clientId) {
      throw new BadRequestException('Cannot start a conversation with yourself');
    }

    // Verify client exists — fail fast with a 404 rather than a FK error.
    const { data: clientRow, error: clientError } = await this.db
      .from('clients')
      .select('user_id')
      .eq('user_id', clientId)
      .maybeSingle();
    if (clientError) throw new InternalServerErrorException('Failed to verify client');
    if (!clientRow) throw new NotFoundException('Client not found');

    const hasBooking = await this.clientHasActiveBookingWithBarber(barberId, clientId);

    const existing = await this.findConversation(barberId, clientId);
    const conversation = existing ?? (await this.createConversation(barberId, clientId, hasBooking));

    // Keep has_booking fresh in case a booking was created between this
    // conversation being started and now.
    if (existing && existing.has_booking !== hasBooking) {
      const { data: updated, error: updateError } = await this.db
        .from('conversations')
        .update({ has_booking: hasBooking })
        .eq('id', existing.id)
        .select(this.CONVERSATION_SELECT)
        .single();
      if (!updateError && updated) {
        return this.buildConversationDetail(updated as ConversationRow, 'barber');
      }
    }

    return this.buildConversationDetail(conversation, 'barber');
  }

  // ────────────────────────────────────────────────────────────
  // Bookings hook — promote has_booking when an active booking exists
  // ────────────────────────────────────────────────────────────

  // Called from the bookings flow whenever a non-cancelled booking is created.
  // No-op when no conversation exists yet — the barber can start one later and
  // startConversation() sets has_booking based on the same query.
  public async markHasBookingIfConversationExists(
    barberId: string,
    clientId: string,
  ): Promise<void> {
    try {
      const existing = await this.findConversation(barberId, clientId);
      if (!existing || existing.has_booking) return;

      const { error } = await this.db
        .from('conversations')
        .update({ has_booking: true })
        .eq('id', existing.id);

      if (error) {
        this.logger.warn(
          `Failed to set has_booking on conversation ${existing.id}: ${error.message}`,
        );
      }
    } catch (err) {
      this.logger.error('markHasBookingIfConversationExists failed', err as Error);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────

  private readonly CONVERSATION_SELECT =
    'id, barber_id, client_id, last_message_body, last_message_at, last_message_sender_role, barber_unread_count, client_unread_count, has_booking, created_at';

  private async loadConversationForParticipant(
    conversationId: string,
    userId: string,
    role: SenderRole,
  ): Promise<ConversationRow> {
    const { data, error } = await this.db
      .from('conversations')
      .select(this.CONVERSATION_SELECT)
      .eq('id', conversationId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to fetch conversation');
    if (!data) throw new NotFoundException('Conversation not found');

    const row = data as ConversationRow;
    const isParticipant =
      (role === 'barber' && row.barber_id === userId) ||
      (role === 'client' && row.client_id === userId);
    if (!isParticipant) {
      throw new ForbiddenException('Not a participant of this conversation');
    }

    return row;
  }

  private async findConversation(
    barberId: string,
    clientId: string,
  ): Promise<ConversationRow | null> {
    const { data, error } = await this.db
      .from('conversations')
      .select(this.CONVERSATION_SELECT)
      .eq('barber_id', barberId)
      .eq('client_id', clientId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to fetch conversation');
    return (data as ConversationRow | null) ?? null;
  }

  private async createConversation(
    barberId: string,
    clientId: string,
    hasBooking: boolean,
  ): Promise<ConversationRow> {
    const { data, error } = await this.db
      .from('conversations')
      .insert({ barber_id: barberId, client_id: clientId, has_booking: hasBooking })
      .select(this.CONVERSATION_SELECT)
      .single();

    if (error || !data) {
      // Race condition: someone inserted the same (barber, client) row between
      // our find and insert. Re-fetch and return that one.
      if (error?.code === '23505') {
        const existing = await this.findConversation(barberId, clientId);
        if (existing) return existing;
      }
      throw new InternalServerErrorException('Failed to create conversation');
    }

    return data as ConversationRow;
  }

  private async fetchConversationsForUser(
    userId: string,
    role: SenderRole,
    otherPartyIdFilter: string[] | null,
  ): Promise<ConversationRow[]> {
    let q = this.db
      .from('conversations')
      .select(this.CONVERSATION_SELECT)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (role === 'barber') {
      q = q.eq('barber_id', userId);
      if (otherPartyIdFilter !== null) {
        if (otherPartyIdFilter.length === 0) return [];
        q = q.in('client_id', otherPartyIdFilter);
      }
    } else {
      q = q.eq('client_id', userId);
      if (otherPartyIdFilter !== null) {
        if (otherPartyIdFilter.length === 0) return [];
        q = q.in('barber_id', otherPartyIdFilter);
      }
    }

    const { data, error } = await q;
    if (error) throw new InternalServerErrorException('Failed to fetch conversations');
    return (data ?? []) as ConversationRow[];
  }

  // Returns null when no search is active (no filtering). Returns an array
  // (possibly empty) when a search term was supplied — empty means nothing
  // matched and the caller should short-circuit.
  private async resolveSearchOtherPartyIds(
    role: SenderRole,
    search?: string,
  ): Promise<string[] | null> {
    if (!search || search.trim().length === 0) return null;

    const escaped = this.escapeForIlike(search);

    if (role === 'barber') {
      const { data, error } = await this.db
        .from('clients')
        .select('user_id')
        .ilike('name', `%${escaped}%`);
      if (error) throw new InternalServerErrorException('Failed to search clients');
      return Array.from(new Set((data ?? []).map((r) => r.user_id as string)));
    }

    const { data, error } = await this.db
      .from('barbers')
      .select('user_id, full_name, shop_name')
      .or(`full_name.ilike.%${escaped}%,shop_name.ilike.%${escaped}%`);
    if (error) throw new InternalServerErrorException('Failed to search barbers');
    return Array.from(new Set((data ?? []).map((r) => r.user_id as string)));
  }

  private async resolveCursorCreatedAt(
    conversationId: string,
    messageId: string,
  ): Promise<string> {
    const { data, error } = await this.db
      .from('messages')
      .select('id, conversation_id, created_at')
      .eq('id', messageId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException('Failed to resolve cursor');
    if (!data || data.conversation_id !== conversationId) {
      throw new BadRequestException('Invalid cursor');
    }
    return data.created_at as string;
  }

  private async markConversationRead(
    conversation: ConversationRow,
    role: SenderRole,
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const otherRole: SenderRole = role === 'barber' ? 'client' : 'barber';

    const { error: msgError } = await this.db
      .from('messages')
      .update({ read_at: nowIso })
      .eq('conversation_id', conversation.id)
      .eq('sender_role', otherRole)
      .is('read_at', null);
    if (msgError) throw new Error(msgError.message);

    const counterField = role === 'barber' ? 'barber_unread_count' : 'client_unread_count';
    const currentCount =
      role === 'barber' ? conversation.barber_unread_count : conversation.client_unread_count;
    if (currentCount === 0) return;

    const { error: convError } = await this.db
      .from('conversations')
      .update({ [counterField]: 0 })
      .eq('id', conversation.id);
    if (convError) throw new Error(convError.message);
  }

  private async clientHasActiveBookingWithBarber(
    barberId: string,
    clientId: string,
  ): Promise<boolean> {
    const { data, error } = await this.db
      .from('bookings')
      .select('id')
      .eq('barber_id', barberId)
      .eq('client_id', clientId)
      .not('status', 'in', `(${NON_BOOKING_STATUSES_EXCLUDED.join(',')})`)
      .limit(1);

    if (error) throw new InternalServerErrorException('Failed to check booking history');
    return (data ?? []).length > 0;
  }

  private async fetchBarbersByIds(ids: string[]): Promise<Map<string, BarberLookup>> {
    const map = new Map<string, BarberLookup>();
    if (ids.length === 0) return map;

    const { data, error } = await this.db
      .from('barbers')
      .select('user_id, full_name, shop_name, profile_photo_url')
      .in('user_id', ids);
    if (error) throw new InternalServerErrorException('Failed to fetch barbers');

    for (const row of data ?? []) {
      const userId = row.user_id as string;
      map.set(userId, {
        user_id: userId,
        name:
          (row.shop_name as string | null) ||
          (row.full_name as string | null) ||
          'Barber',
        profile_photo_url: (row.profile_photo_url as string | null) ?? null,
      });
    }
    return map;
  }

  private async fetchClientsByIds(ids: string[]): Promise<Map<string, ClientLookup>> {
    const map = new Map<string, ClientLookup>();
    if (ids.length === 0) return map;

    const { data, error } = await this.db
      .from('clients')
      .select('user_id, name, profile_photo_url')
      .in('user_id', ids);
    if (error) throw new InternalServerErrorException('Failed to fetch clients');

    for (const row of data ?? []) {
      const userId = row.user_id as string;
      map.set(userId, {
        user_id: userId,
        name: (row.name as string | null) ?? 'Client',
        profile_photo_url: (row.profile_photo_url as string | null) ?? null,
      });
    }
    return map;
  }

  // ────────────────────────────────────────────────────────────
  // Row → DTO mappers
  // ────────────────────────────────────────────────────────────

  private async buildConversationDetail(
    row: ConversationRow,
    role: SenderRole,
  ): Promise<ConversationDetailResponseDto> {
    const otherId = role === 'barber' ? row.client_id : row.barber_id;
    const participants =
      role === 'barber'
        ? await this.fetchClientsByIds([otherId])
        : await this.fetchBarbersByIds([otherId]);
    return {
      conversation: this.mapConversationListItem(row, role, participants),
    };
  }

  private mapConversationListItem(
    row: ConversationRow,
    role: SenderRole,
    participants: Map<string, BarberLookup | ClientLookup>,
  ): ConversationListItemDto {
    const otherId = role === 'barber' ? row.client_id : row.barber_id;
    const participant = participants.get(otherId);
    const fallbackName = role === 'barber' ? 'Client' : 'Barber';

    const otherParty: ConversationParticipantDto = {
      id: otherId,
      name: participant?.name ?? fallbackName,
      profilePhotoUrl: participant?.profile_photo_url ?? null,
    };

    const unreadCount =
      role === 'barber' ? row.barber_unread_count : row.client_unread_count;

    return {
      id: row.id,
      otherParty,
      lastMessageBody: row.last_message_body,
      lastMessageAt: row.last_message_at
        ? new Date(row.last_message_at).toISOString()
        : null,
      lastMessageSenderRole: row.last_message_sender_role,
      unreadCount,
      hasBooking: row.has_booking,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  private mapMessageRow(row: MessageRow): MessageDto {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      senderRole: row.sender_role,
      body: row.body,
      readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  private escapeForIlike(value: string): string {
    return value.replace(/[,()]/g, ' ');
  }
}
