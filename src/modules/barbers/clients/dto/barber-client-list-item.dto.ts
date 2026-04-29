import { ApiProperty } from '@nestjs/swagger';

export class BarberClientListItemDto {
  @ApiProperty({ format: 'uuid' })
  clientId: string;

  @ApiProperty({ example: 'Ahmed Mostafa' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  profilePhotoUrl: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'Auth account email' })
  email: string | null;

  @ApiProperty({ example: 12 })
  totalVisits: number;

  @ApiProperty({ example: 480, description: 'Total spend in USD across completed bookings' })
  totalSpendUsd: number;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'ISO timestamp of the first completed booking',
  })
  firstVisitAt: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'ISO timestamp of the latest completed booking',
  })
  lastVisitAt: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'ISO timestamp of the next pending/confirmed booking',
  })
  nextBookingAt: string | null;

  @ApiProperty()
  hasUpcoming: boolean;

  @ApiProperty({
    description: 'Always false — guest/walk-in bookings are not supported by the schema',
  })
  isGuest: boolean;
}

export class BarberClientsPageMetaDto {
  @ApiProperty() currentPage: number;
  @ApiProperty() totalPages: number;
  @ApiProperty() limit: number;
  @ApiProperty() hasNextPage: boolean;
  @ApiProperty() totalClients: number;
}

export class ListBarberClientsResponseDto {
  @ApiProperty({ type: [BarberClientListItemDto] })
  clients: BarberClientListItemDto[];

  @ApiProperty({ type: BarberClientsPageMetaDto })
  pagination: BarberClientsPageMetaDto;
}
