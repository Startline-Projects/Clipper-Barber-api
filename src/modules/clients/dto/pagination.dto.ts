import { ApiProperty } from '@nestjs/swagger';

export class PageMetaDto {
  @ApiProperty() currentPage: number;
  @ApiProperty() totalPages: number;
  @ApiProperty() limit: number;
  @ApiProperty() hasNextPage: boolean;
}

export class BarbersPageMetaDto extends PageMetaDto {
  @ApiProperty() totalBarbers: number;
}

export class BookingsPageMetaDto extends PageMetaDto {
  @ApiProperty() totalBookings: number;
}
