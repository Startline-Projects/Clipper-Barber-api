import { ApiProperty } from '@nestjs/swagger';
import { NoShowChargeResultDto } from '../../payments/dto/no-show-charge.dto';

export class BarberNoShowBookingDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'no_show' }) status: string;
}

export class NoShowBookingResponseDto {
  @ApiProperty({ type: BarberNoShowBookingDto })
  booking: BarberNoShowBookingDto;

  @ApiProperty({
    type: NoShowChargeResultDto,
    nullable: true,
    description:
      'Stripe charge outcome. Null only if the charge step was skipped due to an unexpected internal error — the booking is still transitioned to no_show.',
  })
  chargeResult: NoShowChargeResultDto | null;
}
