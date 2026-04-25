import { ApiProperty } from '@nestjs/swagger';
import { MessageDto } from './message.dto';

export class SendMessageResponseDto {
  @ApiProperty({ type: MessageDto })
  message!: MessageDto;
}
