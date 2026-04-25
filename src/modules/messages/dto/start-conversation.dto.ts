import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class StartConversationDto {
  @ApiProperty({ description: 'Auth user id of the client to start a conversation with' })
  @IsUUID()
  clientId!: string;
}
