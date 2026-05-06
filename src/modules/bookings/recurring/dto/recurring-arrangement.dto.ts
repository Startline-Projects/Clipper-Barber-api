import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  RecurringArrangementEndType,
  RecurringArrangementFrequency,
} from './create-recurring-arrangement.dto';

export type RecurringArrangementStatus =
  | 'pending_client_approval'
  | 'active'
  | 'rejected'
  | 'cancelled'
  | 'ended';

export class ArrangementBarberSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) shopName: string | null;
  @ApiPropertyOptional({ nullable: true }) avatarUrl: string | null;
}

export class ArrangementClientSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) avatarUrl: string | null;
}

export class ArrangementServiceSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() durationMinutes: number;
  @ApiProperty({ example: 'regular', enum: ['regular', 'after_hours', 'day_off'] })
  bookingType: 'regular' | 'after_hours' | 'day_off';
  @ApiProperty() priceUsd: number;
  @ApiProperty() sortOrder: number;
}

export class RecurringArrangementDto {
  @ApiProperty() id: string;

  @ApiProperty({ enum: ['pending_client_approval', 'active', 'rejected', 'cancelled', 'ended'] })
  status: RecurringArrangementStatus;

  @ApiProperty({ example: 6 }) dayOfWeek: number;
  @ApiProperty({ example: '14:00' }) timeOfDay: string;

  @ApiProperty({ enum: RecurringArrangementFrequency })
  frequency: RecurringArrangementFrequency;

  @ApiPropertyOptional({ nullable: true }) intervalN: number | null;

  @ApiProperty() startDate: string;

  @ApiProperty({ enum: RecurringArrangementEndType })
  endType: RecurringArrangementEndType;

  @ApiPropertyOptional({ nullable: true }) endCount: number | null;
  @ApiPropertyOptional({ nullable: true }) endDate: string | null;
  @ApiPropertyOptional({ nullable: true }) noteToClient: string | null;
  @ApiPropertyOptional({ nullable: true }) rejectionReason: string | null;
  @ApiPropertyOptional({ nullable: true }) respondedAt: string | null;

  @ApiProperty() priceUsd: number;
  @ApiProperty() totalDurationMinutes: number;

  @ApiProperty({ type: ArrangementBarberSummaryDto }) barber: ArrangementBarberSummaryDto;
  @ApiProperty({ type: ArrangementClientSummaryDto }) client: ArrangementClientSummaryDto;

  @ApiProperty({ type: [ArrangementServiceSummaryDto] })
  services: ArrangementServiceSummaryDto[];

  @ApiProperty({
    type: [String],
    description:
      'Up to 5 ISO datetimes for the next upcoming occurrences (computed from the schedule, even when status=pending_client_approval).',
  })
  nextOccurrences: string[];

  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;

  @ApiProperty({
    description:
      'True when the request was an idempotent no-op (e.g. accepting an already-accepted arrangement).',
  })
  noChange: boolean;
}

export class RecurringArrangementResponseDto {
  @ApiProperty({ type: RecurringArrangementDto })
  arrangement: RecurringArrangementDto;
}

export class RecurringArrangementsListResponseDto {
  @ApiProperty({ type: [RecurringArrangementDto] })
  arrangements: RecurringArrangementDto[];

  @ApiPropertyOptional({ nullable: true }) nextCursor: string | null;
  @ApiProperty() hasMore: boolean;
}

export class ArrangementConflictDto {
  @ApiProperty() scheduledAt: string;
  @ApiPropertyOptional({ nullable: true }) conflictingBookingId: string | null;
  @ApiProperty() reason: 'one_off_booking' | 'recurring_booking' | 'recurring_arrangement';
}

export class ArrangementConflictsResponseDto {
  @ApiProperty({ enum: ['arrangement_has_conflicts'] })
  errorCode: 'arrangement_has_conflicts';

  @ApiProperty({ type: [ArrangementConflictDto] })
  conflicts: ArrangementConflictDto[];
}
