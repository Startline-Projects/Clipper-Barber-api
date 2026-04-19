import { ApiProperty } from '@nestjs/swagger';

export class BarberConfirmedBookingDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'confirmed' }) status: string;
  @ApiProperty() confirmedAt: string;
}

export class ConfirmBarberBookingResponseDto {
  @ApiProperty({ type: BarberConfirmedBookingDto }) booking: BarberConfirmedBookingDto;
}
