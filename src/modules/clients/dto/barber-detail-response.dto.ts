import { ApiProperty } from '@nestjs/swagger';
import { ServiceType } from '../../barbers/services/dto/create-barber-service.dto';
import { BarberDistanceDto } from './barber-list-item.dto';

export class BarberWorkingDayDto {
  @ApiProperty({ example: 0, description: '0 = Sunday, 6 = Saturday' })
  dayOfWeek: number;

  @ApiProperty() isWorking: boolean;

  @ApiProperty({ nullable: true, type: String, example: '09:00' })
  startTime: string | null;

  @ApiProperty({ nullable: true, type: String, example: '17:00' })
  endTime: string | null;
}

export class BarberInfoDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) profileImage: string | null;
  @ApiProperty({ nullable: true, type: String }) bio: string | null;
  @ApiProperty({ nullable: true, type: String }) address: string | null;
  @ApiProperty({ nullable: true, type: String }) phone: string | null;
  @ApiProperty({ type: [BarberWorkingDayDto] }) workingHours: BarberWorkingDayDto[];
  @ApiProperty() recurringAvailable: boolean;
}

export class BarberDetailServiceDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ServiceType }) serviceType: ServiceType;
  @ApiProperty() regularPrice: number;
  @ApiProperty() durationMinutes: number;
}

export class BarberDetailReviewDto {
  @ApiProperty() id: string;
  @ApiProperty() reviewerName: string;
  @ApiProperty({ nullable: true, type: String }) reviewerProfileImage: string | null;
  @ApiProperty({ example: 5 }) rating: number;
  @ApiProperty({ nullable: true, type: String }) comment: string | null;
  @ApiProperty() createdAt: string;
}

export class BarberReviewsSummaryDto {
  @ApiProperty({ example: 4.8 }) averageRating: number;
  @ApiProperty({ example: 127 }) totalReviews: number;
}

export class BarberDetailResponseDto {
  @ApiProperty({ type: BarberInfoDto }) barber: BarberInfoDto;
  @ApiProperty({ type: [BarberDetailServiceDto] }) services: BarberDetailServiceDto[];
  @ApiProperty({ type: [BarberDetailReviewDto] }) reviews: BarberDetailReviewDto[];
  @ApiProperty({ type: BarberReviewsSummaryDto }) reviewsSummary: BarberReviewsSummaryDto;
  @ApiProperty({ type: BarberDistanceDto }) distance: BarberDistanceDto;

  @ApiProperty({
    example: false,
    description:
      "True when the authenticated client's clients.subscription_status === 'active'. Lets the client UI gate recurring/subscription-only flows without a separate call.",
  })
  hasActivePlan: boolean;

  @ApiProperty({
    example: 0,
    description:
      'Number of unresolved (or failed) no-shows the authenticated client currently owes across all barbers.',
  })
  unresolvedNoShowsCount: number;

  @ApiProperty({
    example: false,
    description:
      'Soft-warning flag — true when unresolvedNoShowsCount >= 3. Booking is NOT blocked server-side; the frontend may surface a banner / require resolution.',
  })
  hasBlockedNoShows: boolean;
}
