import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { BookingTypeDto, PreviewBookingDto } from './dto/preview-booking.dto';
import { BookingPreviewDto, PreviewBookingResponseDto } from './dto/preview-booking-response.dto';
import { ConfirmBookingResponseDto, ConfirmedBookingDto } from './dto/confirm-booking-response.dto';
import {
  CancelBookingResponseDto,
  CancelledBookingDto,
} from './dto/cancel-booking-response.dto';
import { ListClientBookingsQueryDto } from './dto/list-client-bookings-query.dto';
import {
  BookingStatusDto,
  BookingTimeframeDto,
  BookingTypeFilterDto,
} from '../barbers/dto/list-barber-bookings-query.dto';
import {
  ClientBookingListItemDto,
  ClientBookingsListResponseDto,
} from './dto/client-booking-list-item.dto';
import {
  ClientBookingDetailDto,
  ClientBookingDetailResponseDto,
  ClientBookingReviewDto,
} from './dto/client-booking-detail.dto';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const CLIENT_LIST_SELECT = `
  id, scheduled_at, booking_type, price_usd, status,
  duration_minutes, barber_id, barber_service_id,
  cancelled_at, cancelled_by,
  no_show_charged, no_show_charge_amount_usd,
  recurring_booking_id
`;

const CLIENT_DETAIL_SELECT = `
  id, scheduled_at, booking_type, status,
  duration_minutes, barber_id, barber_service_id,
  base_price_usd, slot_type_surcharge_usd, price_usd,
  confirmed_at, cancelled_at, cancelled_by,
  no_show_charged, no_show_charge_amount_usd,
  recurring_booking_id
`;

interface ClientBookingListRow {
  id: string;
  scheduled_at: string;
  booking_type: string;
  price_usd: string | number;
  status: string;
  duration_minutes: number | null;
  barber_id: string;
  barber_service_id: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  no_show_charged: boolean;
  no_show_charge_amount_usd: string | number | null;
  recurring_booking_id: string | null;
}

interface ClientBookingDetailRow {
  id: string;
  scheduled_at: string;
  booking_type: string;
  status: string;
  duration_minutes: number | null;
  barber_id: string;
  barber_service_id: string | null;
  base_price_usd: string | number | null;
  slot_type_surcharge_usd: string | number | null;
  price_usd: string | number;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  no_show_charged: boolean;
  no_show_charge_amount_usd: string | number | null;
  recurring_booking_id: string | null;
}

interface BarberLite {
  user_id: string;
  full_name: string;
  profile_photo_url: string | null;
}

interface ServiceLite {
  id: string;
  name: string;
  duration_minutes: number;
}

interface BarberServiceRow {
  id: string;
  barber_id: string;
  name: string;
  service_type: string;
  duration_minutes: number;
  regular_price_usd: string | number;
  after_hours_price_usd: string | number | null;
  day_off_price_usd: string | number | null;
  is_active: boolean;
}

interface BarberProfileRow {
  user_id: string;
  full_name: string;
  timezone: string;
  allow_auto_confirm: boolean;
  auto_confirm_today: boolean;
}

interface BarberScheduleRow {
  id: string;
  barber_id: string;
  day_of_week: number;
  is_working: boolean;
  regular_start_time: string | null;
  regular_end_time: string | null;
  after_hours_enabled: boolean;
  after_hours_start: string | null;
  after_hours_end: string | null;
  day_off_booking_enabled: boolean;
  day_off_start_time: string | null;
  day_off_end_time: string | null;
  advance_notice_minutes: number;
}

interface ValidatedSlotContext {
  clientAuthId: string;
  barberProfile: BarberProfileRow;
  service: BarberServiceRow;
  scheduledAtUtc: Date;
  pricing: {
    basePrice: number;
    additionalCost: number;
    totalPrice: number;
  };
}

@Injectable()
export class BookingsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  // ────────────────────────────────────────────────────────────
  // Client bookings — list / detail
  // ────────────────────────────────────────────────────────────

  public async listClientBookings(
    clientId: string,
    query: ListClientBookingsQueryDto
  ): Promise<ClientBookingsListResponseDto> {
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const nowIso = new Date().toISOString();
    const ascending = query.timeframe === BookingTimeframeDto.UPCOMING;

    const cursorRow = await this.resolveClientCursor(clientId, query.cursor);

    let q = this.db.from('bookings').select(CLIENT_LIST_SELECT).eq('client_id', clientId);

    if (query.timeframe === BookingTimeframeDto.UPCOMING) {
      q = q.in('status', ['pending', 'confirmed']).gte('scheduled_at', nowIso);
    } else {
      q = q.or(`status.in.(completed,cancelled,no_show),scheduled_at.lt.${nowIso}`);
    }

    if (query.type === BookingTypeFilterDto.ONE_OFF) {
      q = q.is('recurring_booking_id', null);
    } else if (query.type === BookingTypeFilterDto.RECURRING) {
      q = q.not('recurring_booking_id', 'is', null);
    }

    if (cursorRow) {
      if (ascending) {
        q = q.or(
          `scheduled_at.gt.${cursorRow.scheduled_at},and(scheduled_at.eq.${cursorRow.scheduled_at},id.gt.${cursorRow.id})`
        );
      } else {
        q = q.or(
          `scheduled_at.lt.${cursorRow.scheduled_at},and(scheduled_at.eq.${cursorRow.scheduled_at},id.lt.${cursorRow.id})`
        );
      }
    }

    q = q
      .order('scheduled_at', { ascending })
      .order('id', { ascending })
      .limit(limit + 1);

    const { data, error } = await q;
    if (error) throw new InternalServerErrorException('Failed to fetch bookings');

    const rows = (data ?? []) as ClientBookingListRow[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const { barberMap, serviceMap } = await this.loadClientBookingRelated(
      pageRows.map((r) => r.barber_id),
      pageRows.map((r) => r.barber_service_id).filter((id): id is string => !!id)
    );

    const bookings: ClientBookingListItemDto[] = pageRows.map((r) => {
      const barber = barberMap.get(r.barber_id);
      const service = r.barber_service_id ? serviceMap.get(r.barber_service_id) : undefined;
      const isCancelled = r.status === 'cancelled';
      return {
        id: r.id,
        barber: {
          id: r.barber_id,
          name: barber?.full_name ?? 'Unknown',
          profilePhotoUrl: barber?.profile_photo_url ?? null,
        },
        service: {
          name: service?.name ?? 'Service',
          durationMinutes: service?.duration_minutes ?? r.duration_minutes ?? 0,
        },
        scheduledAt: new Date(r.scheduled_at).toISOString(),
        bookingType: r.booking_type as BookingTypeDto,
        totalPrice: Number(r.price_usd),
        status: r.status as BookingStatusDto,
        cancelledAt: isCancelled && r.cancelled_at ? new Date(r.cancelled_at).toISOString() : null,
        cancelledBy: isCancelled ? ((r.cancelled_by as 'client' | 'barber' | null) ?? null) : null,
        noShowCharged: r.no_show_charged,
        noShowChargeAmountUsd:
          r.no_show_charge_amount_usd !== null && r.no_show_charge_amount_usd !== undefined
            ? Number(r.no_show_charge_amount_usd)
            : null,
        isRecurring: r.recurring_booking_id !== null,
        recurringBookingId: r.recurring_booking_id,
      };
    });

    return {
      bookings,
      nextCursor: hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
      hasMore,
    };
  }

  public async getClientBookingDetail(
    clientId: string,
    bookingId: string
  ): Promise<ClientBookingDetailResponseDto> {
    const { data, error } = await this.db
      .from('bookings')
      .select(CLIENT_DETAIL_SELECT)
      .eq('id', bookingId)
      .eq('client_id', clientId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to fetch booking');
    if (!data) throw new NotFoundException('Booking not found');

    const row = data as ClientBookingDetailRow;

    const { barberMap, serviceMap } = await this.loadClientBookingRelated(
      [row.barber_id],
      row.barber_service_id ? [row.barber_service_id] : []
    );

    const barber = barberMap.get(row.barber_id);
    const service = row.barber_service_id ? serviceMap.get(row.barber_service_id) : undefined;

    const { data: reviewRow, error: reviewError } = await this.db
      .from('reviews')
      .select('id, rating, comment, created_at')
      .eq('booking_id', bookingId)
      .maybeSingle();

    if (reviewError) throw new InternalServerErrorException('Failed to fetch review');

    const review: ClientBookingReviewDto | null = reviewRow
      ? {
          id: reviewRow.id as string,
          rating: reviewRow.rating as number,
          comment: (reviewRow.comment as string | null) ?? null,
          createdAt: new Date(reviewRow.created_at as string).toISOString(),
        }
      : null;

    const basePrice =
      row.base_price_usd !== null && row.base_price_usd !== undefined
        ? Number(row.base_price_usd)
        : Number(row.price_usd);
    const additionalCost =
      row.slot_type_surcharge_usd !== null && row.slot_type_surcharge_usd !== undefined
        ? Number(row.slot_type_surcharge_usd)
        : 0;
    const totalPrice = Number(row.price_usd);

    const isCancelled = row.status === 'cancelled';

    const booking: ClientBookingDetailDto = {
      id: row.id,
      barber: {
        id: row.barber_id,
        name: barber?.full_name ?? 'Unknown',
        profilePhotoUrl: barber?.profile_photo_url ?? null,
      },
      service: {
        name: service?.name ?? 'Service',
        durationMinutes: service?.duration_minutes ?? row.duration_minutes ?? 0,
      },
      scheduledAt: new Date(row.scheduled_at).toISOString(),
      bookingType: row.booking_type as BookingTypeDto,
      totalPrice,
      status: row.status as BookingStatusDto,
      cancelledAt: isCancelled && row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
      cancelledBy: isCancelled ? ((row.cancelled_by as 'client' | 'barber' | null) ?? null) : null,
      noShowCharged: row.no_show_charged,
      noShowChargeAmountUsd:
        row.no_show_charge_amount_usd !== null && row.no_show_charge_amount_usd !== undefined
          ? Number(row.no_show_charge_amount_usd)
          : null,
      pricing: { basePrice, additionalCost, totalPrice },
      confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
      review,
      isRecurring: row.recurring_booking_id !== null,
      recurringBookingId: row.recurring_booking_id,
    };

    return { booking };
  }

  private async resolveClientCursor(
    clientId: string,
    cursor?: string
  ): Promise<{ id: string; scheduled_at: string } | null> {
    if (!cursor) return null;
    const { data, error } = await this.db
      .from('bookings')
      .select('id, scheduled_at')
      .eq('id', cursor)
      .eq('client_id', clientId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to resolve cursor');
    if (!data) return null;
    return { id: data.id as string, scheduled_at: data.scheduled_at as string };
  }

  private async loadClientBookingRelated(
    barberIds: string[],
    serviceIds: string[]
  ): Promise<{
    barberMap: Map<string, BarberLite>;
    serviceMap: Map<string, ServiceLite>;
  }> {
    const barberMap = new Map<string, BarberLite>();
    const serviceMap = new Map<string, ServiceLite>();

    const uniqueBarberIds = Array.from(new Set(barberIds));
    if (uniqueBarberIds.length > 0) {
      const { data, error } = await this.db
        .from('barbers')
        .select('user_id, full_name, profile_photo_url')
        .in('user_id', uniqueBarberIds);
      if (error) throw new InternalServerErrorException('Failed to fetch barbers');
      for (const b of data ?? []) {
        barberMap.set(b.user_id as string, {
          user_id: b.user_id as string,
          full_name: b.full_name as string,
          profile_photo_url: (b.profile_photo_url as string | null) ?? null,
        });
      }
    }

    const uniqueServiceIds = Array.from(new Set(serviceIds));
    if (uniqueServiceIds.length > 0) {
      const { data, error } = await this.db
        .from('barber_services')
        .select('id, name, duration_minutes')
        .in('id', uniqueServiceIds);
      if (error) throw new InternalServerErrorException('Failed to fetch services');
      for (const s of data ?? []) {
        serviceMap.set(s.id as string, {
          id: s.id as string,
          name: s.name as string,
          duration_minutes: s.duration_minutes as number,
        });
      }
    }

    return { barberMap, serviceMap };
  }

  // ────────────────────────────────────────────────────────────
  // Client bookings — mutations
  // ────────────────────────────────────────────────────────────

  public async cancelClientBooking(
    clientId: string,
    bookingId: string
  ): Promise<CancelBookingResponseDto> {
    const { data: existingBooking, error: fetchError } = await this.db
      .from('bookings')
      .select('id, status, scheduled_at')
      .eq('id', bookingId)
      .eq('client_id', clientId)
      .maybeSingle();

    if (fetchError) throw new InternalServerErrorException('Failed to fetch booking');
    if (!existingBooking) {
      throw new NotFoundException('Booking not found');
    }

    const status = existingBooking.status as string;
    if (status === 'cancelled' || status === 'completed' || status === 'no_show') {
      throw new BadRequestException('This booking cannot be cancelled.');
    }

    const scheduledAt = new Date(existingBooking.scheduled_at as string);
    if (scheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException('Cannot cancel a past booking.');
    }

    const cancelledAt = new Date().toISOString();
    const { data: updated, error: updateError } = await this.db
      .from('bookings')
      .update({
        status: 'cancelled',
        cancelled_at: cancelledAt,
        cancelled_by: 'client',
      })
      .eq('id', bookingId)
      .eq('client_id', clientId)
      .select('id, status, scheduled_at, cancelled_at, cancelled_by')
      .single();

    if (updateError || !updated) {
      throw new InternalServerErrorException('Failed to cancel booking');
    }

    const booking: CancelledBookingDto = {
      id: updated.id as string,
      status: updated.status as string,
      scheduledAt: new Date(updated.scheduled_at as string).toISOString(),
      cancelledAt: new Date(updated.cancelled_at as string).toISOString(),
      cancelledBy: updated.cancelled_by as 'client' | 'barber',
    };

    return { booking };
  }

  public async previewBooking(
    authUserId: string,
    dto: PreviewBookingDto
  ): Promise<PreviewBookingResponseDto> {
    const ctx = await this.validateBookingSlot(authUserId, dto);

    const preview: BookingPreviewDto = {
      scheduledAt: ctx.scheduledAtUtc.toISOString(),
      bookingType: dto.bookingType,
      service: {
        id: ctx.service.id,
        name: ctx.service.name,
        durationMinutes: ctx.service.duration_minutes,
      },
      pricing: ctx.pricing,
      barber: {
        id: ctx.barberProfile.user_id,
        name: ctx.barberProfile.full_name,
      },
    };

    return { preview };
  }

  public async confirmBooking(
    authUserId: string,
    dto: PreviewBookingDto
  ): Promise<ConfirmBookingResponseDto> {
    const ctx = await this.validateBookingSlot(authUserId, dto);

    // TODO: enforce subscription

    const initialStatus = this.resolveInitialBookingStatus(
      ctx.barberProfile,
      ctx.scheduledAtUtc
    );
    const nowIso = new Date().toISOString();

    const { data, error } = await this.db
      .from('bookings')
      .insert({
        barber_id: ctx.barberProfile.user_id,
        client_id: ctx.clientAuthId,
        barber_service_id: ctx.service.id,
        service_type: ctx.service.service_type,
        booking_type: dto.bookingType,
        scheduled_at: ctx.scheduledAtUtc.toISOString(),
        duration_minutes: ctx.service.duration_minutes,
        base_price_usd: ctx.pricing.basePrice,
        slot_type_surcharge_usd: ctx.pricing.additionalCost,
        price_usd: ctx.pricing.totalPrice,
        status: initialStatus,
        confirmed_at: initialStatus === 'confirmed' ? nowIso : null,
      })
      .select('id, status, scheduled_at, confirmed_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('This slot was just taken. Please select another time.');
      }
      throw new InternalServerErrorException('Failed to create booking');
    }

    const row = data as {
      id: string;
      status: string;
      scheduled_at: string;
      confirmed_at: string | null;
    };

    const booking: ConfirmedBookingDto = {
      id: row.id,
      status: row.status,
      scheduledAt: new Date(row.scheduled_at).toISOString(),
      bookingType: dto.bookingType,
      service: {
        id: ctx.service.id,
        name: ctx.service.name,
        durationMinutes: ctx.service.duration_minutes,
      },
      pricing: ctx.pricing,
      barber: {
        id: ctx.barberProfile.user_id,
        name: ctx.barberProfile.full_name,
      },
      confirmedAt: row.confirmed_at,
    };

    return { booking };
  }

  // allow_auto_confirm wins unconditionally. auto_confirm_today only fires
  // if the slot's barber-local calendar date matches today's barber-local date.
  private resolveInitialBookingStatus(
    barber: BarberProfileRow,
    scheduledAtUtc: Date
  ): 'pending' | 'confirmed' {
    if (barber.allow_auto_confirm) return 'confirmed';
    if (barber.auto_confirm_today) {
      const slotLocalDate = this.formatLocalDate(scheduledAtUtc, barber.timezone);
      const todayLocalDate = this.formatLocalDate(new Date(), barber.timezone);
      if (slotLocalDate === todayLocalDate) return 'confirmed';
    }
    return 'pending';
  }

  private formatLocalDate(instant: Date, timezone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
    const y = parts.find((p) => p.type === 'year')?.value ?? '';
    const m = parts.find((p) => p.type === 'month')?.value ?? '';
    const d = parts.find((p) => p.type === 'day')?.value ?? '';
    return `${y}-${m}-${d}`;
  }

  private async validateBookingSlot(
    authUserId: string,
    dto: PreviewBookingDto
  ): Promise<ValidatedSlotContext> {
    // 1. Authenticated client exists (existence check — FK uses auth.users.id directly)
    const { data: clientRow, error: clientError } = await this.db
      .from('clients')
      .select('user_id')
      .eq('user_id', authUserId)
      .maybeSingle();

    if (clientError) throw new InternalServerErrorException('Failed to fetch client profile');
    if (!clientRow) throw new NotFoundException('Client profile not found');

    // 2. Fetch barber profile (name + timezone + auto-confirm flags)
    const { data: barberRow, error: barberError } = await this.db
      .from('barbers')
      .select('user_id, full_name, timezone, allow_auto_confirm, auto_confirm_today')
      .eq('user_id', dto.barberId)
      .maybeSingle();

    if (barberError) throw new InternalServerErrorException('Failed to fetch barber');
    if (!barberRow) throw new NotFoundException('Barber not found');

    const barberProfile = barberRow as BarberProfileRow;

    // 3. Service belongs to barber and is active
    const { data: serviceRow, error: serviceError } = await this.db
      .from('barber_services')
      .select(
        'id, barber_id, name, service_type, duration_minutes, regular_price_usd, after_hours_price_usd, day_off_price_usd, is_active'
      )
      .eq('id', dto.barberServiceId)
      .eq('barber_id', dto.barberId)
      .eq('is_active', true)
      .maybeSingle();

    if (serviceError) throw new InternalServerErrorException('Failed to fetch service');
    if (!serviceRow) {
      throw new NotFoundException('Service not found or inactive for this barber');
    }

    const service = serviceRow as BarberServiceRow;

    // 4. Derive day-of-week from the calendar date (TZ-independent: the date is
    //    already expressed in the barber's local calendar)
    const dayOfWeek = this.dayOfWeekFromDate(dto.date);

    const { data: scheduleRow, error: scheduleError } = await this.db
      .from('barber_schedules')
      .select('*')
      .eq('barber_id', dto.barberId)
      .eq('day_of_week', dayOfWeek)
      .maybeSingle();

    if (scheduleError) throw new InternalServerErrorException('Failed to fetch schedule');
    if (!scheduleRow) {
      throw new BadRequestException('Barber has no schedule configured for this day');
    }

    const schedule = scheduleRow as BarberScheduleRow;

    // 5. Validate the slot time sits in the right window for its booking type.
    this.validateSlotWindow(schedule, dto.bookingType, dto.slotTime);

    // 6. Compose the UTC timestamp for the slot using the barber's timezone
    const scheduledAtUtc = this.composeUtcFromLocal(dto.date, dto.slotTime, barberProfile.timezone);

    // 7. Advance notice check — UTC vs UTC, TZ-safe
    const advanceCutoff = new Date(
      scheduledAtUtc.getTime() - schedule.advance_notice_minutes * 60_000
    );
    if (advanceCutoff.getTime() <= Date.now()) {
      throw new BadRequestException('Advance notice window has passed — please pick a later slot.');
    }

    // 8. Service has pricing for the booking type
    const pricing = this.resolvePricing(service, dto.bookingType);

    // 9. Slot not already taken (unique index is defined on (barber_id, scheduled_at))
    const { data: existingBooking, error: conflictError } = await this.db
      .from('bookings')
      .select('id')
      .eq('barber_id', dto.barberId)
      .eq('scheduled_at', scheduledAtUtc.toISOString())
      .neq('status', 'cancelled')
      .maybeSingle();

    if (conflictError) throw new InternalServerErrorException('Failed to check slot availability');
    if (existingBooking) {
      throw new ConflictException('This slot is already booked.');
    }

    return {
      clientAuthId: authUserId,
      barberProfile,
      service,
      scheduledAtUtc,
      pricing,
    };
  }

  private validateSlotWindow(
    schedule: BarberScheduleRow,
    bookingType: BookingTypeDto,
    slotTime: string
  ): void {
    const minutesOfDay = this.timeToMinutes(slotTime);

    if (bookingType === BookingTypeDto.REGULAR) {
      if (!schedule.is_working) {
        throw new BadRequestException('Barber is not working on this day for regular bookings.');
      }
      if (!schedule.regular_start_time || !schedule.regular_end_time) {
        throw new BadRequestException('Regular hours are not configured for this day.');
      }
      this.assertWithinWindow(
        minutesOfDay,
        schedule.regular_start_time,
        schedule.regular_end_time,
        'regular'
      );
      return;
    }

    if (bookingType === BookingTypeDto.AFTER_HOURS) {
      if (!schedule.after_hours_enabled) {
        throw new BadRequestException('After-hours bookings are not enabled for this day.');
      }
      if (!schedule.after_hours_start || !schedule.after_hours_end) {
        throw new BadRequestException('After-hours window is not configured for this day.');
      }
      this.assertWithinWindow(
        minutesOfDay,
        schedule.after_hours_start,
        schedule.after_hours_end,
        'after_hours'
      );
      return;
    }

    // day_off
    if (schedule.is_working || !schedule.day_off_booking_enabled) {
      throw new BadRequestException('Day-off bookings are not enabled for this day.');
    }
    if (!schedule.day_off_start_time || !schedule.day_off_end_time) {
      throw new BadRequestException('Day-off window is not configured for this day.');
    }
    this.assertWithinWindow(
      minutesOfDay,
      schedule.day_off_start_time,
      schedule.day_off_end_time,
      'day_off'
    );
  }

  private assertWithinWindow(
    minutesOfDay: number,
    startTime: string,
    endTime: string,
    typeLabel: string
  ): void {
    const start = this.timeToMinutes(startTime);
    const end = this.timeToMinutes(endTime);
    if (minutesOfDay < start || minutesOfDay >= end) {
      throw new BadRequestException(`slotTime is outside the ${typeLabel} window for this day.`);
    }
  }

  private timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private dayOfWeekFromDate(date: string): number {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  private composeUtcFromLocal(date: string, time: string, timezone: string): Date {
    const [y, mo, d] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    const targetUtcMs = Date.UTC(y, mo - 1, d, h, mi, 0);

    let offsetMs = this.tzOffsetMs(new Date(targetUtcMs), timezone);
    let guess = new Date(targetUtcMs - offsetMs);
    offsetMs = this.tzOffsetMs(guess, timezone);
    guess = new Date(targetUtcMs - offsetMs);
    return guess;
  }

  private tzOffsetMs(instant: Date, timezone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(instant);

    const pick = (t: string): number => {
      const part = parts.find((p) => p.type === t);
      if (!part) throw new InternalServerErrorException(`Invalid timezone: ${timezone}`);
      return Number(part.value);
    };

    const wallAsUtcMs = Date.UTC(
      pick('year'),
      pick('month') - 1,
      pick('day'),
      pick('hour') === 24 ? 0 : pick('hour'),
      pick('minute'),
      pick('second')
    );
    return wallAsUtcMs - instant.getTime();
  }

  private resolvePricing(
    service: BarberServiceRow,
    bookingType: BookingTypeDto
  ): { basePrice: number; additionalCost: number; totalPrice: number } {
    const basePrice = Number(service.regular_price_usd);

    if (bookingType === BookingTypeDto.REGULAR) {
      return { basePrice, additionalCost: 0, totalPrice: basePrice };
    }

    const typePriceRaw =
      bookingType === BookingTypeDto.AFTER_HOURS
        ? service.after_hours_price_usd
        : service.day_off_price_usd;

    if (typePriceRaw === null || typePriceRaw === undefined) {
      throw new BadRequestException(`This service is not available for ${bookingType} bookings.`);
    }

    const totalPrice = Number(typePriceRaw);
    const additionalCost = Number((totalPrice - basePrice).toFixed(2));

    return { basePrice, additionalCost, totalPrice };
  }
}
