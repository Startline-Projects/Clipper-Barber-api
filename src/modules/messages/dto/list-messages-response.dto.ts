import { ApiProperty } from '@nestjs/swagger';
import { MessageDto } from './message.dto';

export class ListMessagesResponseDto {
  // Ascending by created_at (oldest first) so the client can append to the
  // top of the thread when loading older pages.
  @ApiProperty({ type: [MessageDto] })
  messages!: MessageDto[];

  @ApiProperty({
    description: 'True when more historical messages exist before the oldest in this page',
  })
  hasMore!: boolean;

  @ApiProperty({
    description:
      'Cursor to pass as `before` on the next page request. Null when no more history.',
    nullable: true,
  })
  nextCursor!: string | null;
}
