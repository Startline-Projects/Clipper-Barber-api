import { ApiProperty } from '@nestjs/swagger';
import { ConversationListItemDto } from './conversation-list-item.dto';

export class ConversationsPaginationDto {
  @ApiProperty()
  currentPage!: number;

  @ApiProperty()
  totalPages!: number;

  @ApiProperty()
  totalConversations!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  hasNextPage!: boolean;
}

export class ListConversationsResponseDto {
  @ApiProperty({ type: [ConversationListItemDto] })
  conversations!: ConversationListItemDto[];

  @ApiProperty({ type: ConversationsPaginationDto })
  pagination!: ConversationsPaginationDto;
}
