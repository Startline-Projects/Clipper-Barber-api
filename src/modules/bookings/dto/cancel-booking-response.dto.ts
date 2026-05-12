import { ApiProperty } from '@nestjs/swagger';

export class CancelledBookingDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'cancelled' }) status: string;
  @ApiProperty({ example: '2026-05-12T00:30:00.000Z', description: 'UTC instant (ISO 8601)' })
  scheduledAt: string;
  @ApiProperty({ example: 'America/New_York', description: 'Barber IANA timezone' })
  timezone: string;
  @ApiProperty({ example: '2026-05-11', description: 'Local calendar date in `timezone` (YYYY-MM-DD)' })
  appointmentDate: string;
  @ApiProperty({ example: '20:30', description: 'Local wall-clock in `timezone` (HH:MM)' })
  appointmentTime: string;
  @ApiProperty() cancelledAt: string;
  @ApiProperty({ enum: ['client', 'barber'], example: 'client' }) cancelledBy: 'client' | 'barber';
}

export class CancelBookingResponseDto {
  @ApiProperty({ type: CancelledBookingDto }) booking: CancelledBookingDto;
}
