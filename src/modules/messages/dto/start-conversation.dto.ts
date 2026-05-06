import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class StartConversationDto {
  @ApiProperty({
    description:
      'Auth user id of the other party. A barber passes a client id; a client passes a barber id.',
  })
  @IsUUID()
  otherUserId!: string;
}
