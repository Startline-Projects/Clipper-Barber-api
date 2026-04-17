import { ApiProperty } from '@nestjs/swagger';

export class BarberCancelledBookingDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'cancelled' }) status: string;
  @ApiProperty() cancelledAt: string;
  @ApiProperty({ enum: ['client', 'barber'], example: 'barber' }) cancelledBy: 'barber';
}

export class CancelBarberBookingResponseDto {
  @ApiProperty({ type: BarberCancelledBookingDto }) booking: BarberCancelledBookingDto;
}
