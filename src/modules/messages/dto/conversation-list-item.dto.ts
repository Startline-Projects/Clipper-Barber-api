import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConversationParticipantDto {
  @ApiProperty({ description: 'Auth user id of the other party' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  profilePhotoUrl!: string | null;
}

export class ConversationListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: ConversationParticipantDto })
  otherParty!: ConversationParticipantDto;

  @ApiPropertyOptional({ nullable: true })
  lastMessageBody!: string | null;

  @ApiPropertyOptional({ nullable: true })
  lastMessageAt!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: ['barber', 'client'],
  })
  lastMessageSenderRole!: 'barber' | 'client' | null;

  @ApiProperty({
    description: 'Unread count for the requesting user (0 for their own unread counter)',
  })
  unreadCount!: number;

  @ApiProperty({
    description:
      'Whether the client has a non-cancelled booking with this barber. Barber-side flag — still returned to clients for UI parity.',
  })
  hasBooking!: boolean;

  @ApiProperty()
  createdAt!: string;
}
