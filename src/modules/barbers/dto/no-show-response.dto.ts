import { ApiProperty } from '@nestjs/swagger';

export class BarberNoShowBookingDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'no_show' }) status: string;
}

export class NoShowBookingResponseDto {
  @ApiProperty({ type: BarberNoShowBookingDto }) booking: BarberNoShowBookingDto;
}
