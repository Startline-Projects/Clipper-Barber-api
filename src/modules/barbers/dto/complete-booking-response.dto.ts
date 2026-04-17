import { ApiProperty } from '@nestjs/swagger';

export class BarberCompletedBookingDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'completed' }) status: string;
}

export class CompleteBookingResponseDto {
  @ApiProperty({ type: BarberCompletedBookingDto }) booking: BarberCompletedBookingDto;
}
