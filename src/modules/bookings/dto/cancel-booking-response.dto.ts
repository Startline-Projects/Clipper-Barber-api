import { ApiProperty } from '@nestjs/swagger';

export class CancelledBookingDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'cancelled' }) status: string;
  @ApiProperty() scheduledAt: string;
  @ApiProperty() cancelledAt: string;
  @ApiProperty({ enum: ['client', 'barber'], example: 'client' }) cancelledBy: 'client' | 'barber';
}

export class CancelBookingResponseDto {
  @ApiProperty({ type: CancelledBookingDto }) booking: CancelledBookingDto;
}
