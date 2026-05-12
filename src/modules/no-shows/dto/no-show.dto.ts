import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export enum NoShowStatusDto {
  UNRESOLVED = 'unresolved',
  PENDING_PAYMENT = 'pending_payment',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

export class NoShowBookingSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty({ description: 'ISO timestamp of the missed appointment.' })
  scheduledAt: string;
  @ApiProperty({ nullable: true, type: String }) serviceName: string | null;
}

export class NoShowPartyDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) profilePhotoUrl: string | null;
}

export class NoShowItemDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: NoShowStatusDto }) status: NoShowStatusDto;
  @ApiProperty({ example: 25 }) amountUsd: number;
  @ApiProperty({ example: 'usd' }) currency: string;
  @ApiProperty({ nullable: true, type: String }) reason: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty({ nullable: true, type: String }) resolvedAt: string | null;
  @ApiProperty({ type: NoShowBookingSummaryDto }) booking: NoShowBookingSummaryDto;
  @ApiProperty({ type: NoShowPartyDto, description: 'The other party (barber for client-side, client for barber-side).' })
  counterparty: NoShowPartyDto;
}

export class NoShowListPaginationDto {
  @ApiProperty() currentPage: number;
  @ApiProperty() totalPages: number;
  @ApiProperty() totalItems: number;
  @ApiProperty() limit: number;
  @ApiProperty() hasNextPage: boolean;
}

export class ListNoShowsResponseDto {
  @ApiProperty({
    type: [NoShowItemDto],
    description:
      'No-shows ordered with unresolved/failed first (oldest unresolved at the top of that bucket), then resolved/refunded by created_at DESC.',
  })
  items: NoShowItemDto[];

  @ApiProperty({ type: NoShowListPaginationDto }) pagination: NoShowListPaginationDto;
}

export class ListNoShowsQueryDto {
  @ApiPropertyOptional({ enum: NoShowStatusDto, description: 'Optional exact-status filter.' })
  @IsOptional()
  @IsEnum(NoShowStatusDto)
  status?: NoShowStatusDto;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class BarberNoShowStatsDto {
  @ApiProperty({ example: 4 }) unresolvedCount: number;
  @ApiProperty({ example: 100, description: 'Total USD of unresolved + failed rows owed to this barber.' })
  unresolvedAmountUsd: number;

  @ApiProperty({ example: 12 }) resolvedCount: number;
  @ApiProperty({ example: 360, description: 'Total USD this barber has received from resolved no-shows.' })
  resolvedAmountUsd: number;

  @ApiProperty({ example: 360, description: 'Lifetime earnings from no-show fees (paid rows only).' })
  totalEarningsUsd: number;
}

export class BarberNoShowStatsResponseDto {
  @ApiProperty({ type: BarberNoShowStatsDto }) stats: BarberNoShowStatsDto;
}

export class InitiateNoShowPaymentResponseDto {
  @ApiProperty({ description: 'The no-show row id.' }) noShowId: string;
  @ApiProperty({ description: 'Stripe PaymentIntent id.' }) paymentIntentId: string;
  @ApiProperty({ description: 'Use with stripe-js confirmCardPayment / Payment Sheet.' })
  clientSecret: string;
  @ApiProperty({ enum: NoShowStatusDto, example: NoShowStatusDto.PENDING_PAYMENT })
  status: NoShowStatusDto;
  @ApiProperty({ example: 25 }) amountUsd: number;
  @ApiProperty({ example: 'usd' }) currency: string;
}
