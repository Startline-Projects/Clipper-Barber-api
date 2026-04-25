import { ApiProperty } from '@nestjs/swagger';
import { ConversationListItemDto } from './conversation-list-item.dto';

export class ConversationDetailResponseDto {
  @ApiProperty({ type: ConversationListItemDto })
  conversation!: ConversationListItemDto;
}
