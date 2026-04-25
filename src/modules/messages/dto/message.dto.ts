import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MessageDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  conversationId!: string;

  @ApiProperty({ enum: ['barber', 'client'] })
  senderRole!: 'barber' | 'client';

  @ApiProperty()
  body!: string;

  @ApiPropertyOptional({ nullable: true })
  readAt!: string | null;

  @ApiProperty()
  createdAt!: string;
}
