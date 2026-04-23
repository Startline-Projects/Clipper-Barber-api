import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum NotificationTypeDto {
  NEW_BOOKING = 'new_booking',
  CANCELLED_BOOKING = 'cancelled_booking',
  NEW_RECURRING_REQUEST = 'new_recurring_request',
  RECURRING_CANCELLED = 'recurring_cancelled',
  RECURRING_PAUSED = 'recurring_paused',
  BOOKING_CONFIRMED = 'booking_confirmed',
  BOOKING_CANCELLED = 'booking_cancelled',
  RECURRING_ACCEPTED = 'recurring_accepted',
  RECURRING_REFUSED = 'recurring_refused',
  RECURRING_EXPIRING = 'recurring_expiring',
}

export class NotificationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: NotificationTypeDto })
  type!: NotificationTypeDto;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty({ type: Object, additionalProperties: true })
  data!: Record<string, unknown>;

  @ApiProperty()
  isRead!: boolean;

  @ApiPropertyOptional({ nullable: true })
  bookingId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  recurringBookingId!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class NotificationPaginationDto {
  @ApiProperty()
  currentPage!: number;

  @ApiProperty()
  totalPages!: number;

  @ApiProperty()
  totalNotifications!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  hasNextPage!: boolean;
}

export class ListNotificationsResponseDto {
  @ApiProperty({ type: [NotificationDto] })
  notifications!: NotificationDto[];

  @ApiProperty({ type: NotificationPaginationDto })
  pagination!: NotificationPaginationDto;
}

export class MarkNotificationReadResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  isRead!: boolean;
}

export class UnreadCountResponseDto {
  @ApiProperty()
  unreadCount!: number;
}
