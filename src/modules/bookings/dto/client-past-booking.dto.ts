import { ApiProperty } from '@nestjs/swagger';
import { BookingsPageMetaDto } from '../../clients/dto/pagination.dto';

export class ClientPastBookingDto {
  @ApiProperty() id: string;
  @ApiProperty() barberName: string;
  @ApiProperty({ nullable: true, type: String }) barberProfileImage: string | null;
  @ApiProperty() serviceName: string;
  @ApiProperty({ example: '2026-03-14' }) appointmentDate: string;
  @ApiProperty({ example: '10:30' }) appointmentTime: string;
  @ApiProperty({ example: 45.0 }) pricePaid: number;
  @ApiProperty() hasReview: boolean;
}

export class ClientPastBookingsResponseDto {
  @ApiProperty({ type: [ClientPastBookingDto] })
  bookings: ClientPastBookingDto[];

  @ApiProperty({ type: BookingsPageMetaDto })
  pagination: BookingsPageMetaDto;
}
