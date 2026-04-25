import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationTypeDto } from '../notifications/dto/notification.dto';
import { ConversationsService } from '../messages/conversations.service';
import { BookingTypeDto, PreviewBookingDto } from './dto/preview-booking.dto';
import {
  BookingPreviewDto,
  BookingServiceSummaryDto,
  PreviewBookingResponseDto,
} from './dto/preview-booking-response.dto';
import { ConfirmBookingResponseDto, ConfirmedBookingDto } from './dto/confirm-booking-response.dto';
import {
  CancelBookingResponseDto,
  CancelledBookingDto,
} from './dto/cancel-booking-response.dto';
import { BookingStatusDto } from '../barbers/dto/list-barber-bookings-query.dto';
import {
  ClientBookingDetailDto,
  ClientBookingDetailResponseDto,
  ClientBookingReviewDto,
  ClientBookingServiceSummaryDto,
} from './dto/client-booking-detail.dto';
import { ClientBookingsPageQueryDto } from './dto/client-bookings-page-query.dto';
import {
  ClientUpcomingBookingDto,
  ClientUpcomingBookingsResponseDto,
} from './dto/client-upcoming-booking.dto';
import {
  ClientPastBookingDto,
  ClientPastBookingsResponseDto,
} from './dto/client-past-booking.dto';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const CLIENT_DETAIL_SELECT = `
  id, scheduled_at, booking_type, status,
  duration_minutes, barber_id, barber_service_id,
  base_price_usd, slot_type_surcharge_usd, price_usd,
  confirmed_at, cancelled_at, cancelled_by,
  no_show_charged, no_show_charge_amount_usd,
  recurring_booking_id
`;

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
  slot_duration_minutes: number;
  after_hours_enabled: boolean;
  after_hours_start: string | null;
  after_hours_end: string | null;
  day_off_booking_enabled: boolean;
  day_off_start_time: string | null;
  day_off_end_time: string | null;
  advance_notice_minutes: number;
}

interface ResolvedBookingService {
  service: BarberServiceRow;
  bookingType: BookingTypeDto;
  startOffsetMinutes: number;
  pricing: {
    basePrice: number;
    additionalCost: number;
    totalPrice: number;
  };
}

interface ValidatedSlotContext {
  clientAuthId: string;
  barberProfile: BarberProfileRow;
  services: ResolvedBookingService[];
  // Each service occupies exactly one grid slot of this length. The block
  // is `services.length * slotDurationMinutes` long.
  slotDurationMinutes: number;
  totalDurationMinutes: number;
  scheduledAtUtc: Date;
  totalPricing: {
    basePrice: number;
    additionalCost: number;
    totalPrice: number;
  };
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly notificationsService: NotificationsService,
    private readonly conversationsService: ConversationsService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  // ────────────────────────────────────────────────────────────
  // Client bookings — upcoming / past (page-based)
  // ────────────────────────────────────────────────────────────

  public async listClientUpcomingBookings(
    clientId: string,
    query: ClientBookingsPageQueryDto,
  ): Promise<ClientUpcomingBookingsResponseDto> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const nowIso = new Date().toISOString();

    // Fetch all upcoming ids to dedupe recurring (keep earliest per recurring_booking_id)
    const { data: idRows, error: idErr } = await this.db
      .from('bookings')
      .select('id, scheduled_at, recurring_booking_id')
      .eq('client_id', clientId)
      .in('status', ['pending', 'confirmed'])
      .gte('scheduled_at', nowIso)
      .order('scheduled_at', { ascending: true })
      .order('id', { ascending: true });

    if (idErr) throw new InternalServerErrorException('Failed to fetch bookings');

    const deduped = this.dedupRecurringUpcoming(
      (idRows ?? []) as { id: string; scheduled_at: string; recurring_booking_id: string | null }[],
    );

    const totalBookings = deduped.length;
    const totalPages = Math.max(1, Math.ceil(totalBookings / limit));
    const startIndex = (page - 1) * limit;
    const pageIds = deduped.slice(startIndex, startIndex + limit).map((r) => r.id);

    const bookings = await this.hydrateUpcomingBookings(pageIds);

    return {
      bookings,
      pagination: {
        currentPage: page,
        totalPages,
        totalBookings,
        limit,
        hasNextPage: page < totalPages,
      },
    };
  }

  public async listClientPastBookings(
    clientId: string,
    query: ClientBookingsPageQueryDto,
  ): Promise<ClientPastBookingsResponseDto> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const nowIso = new Date().toISOString();

    const { count, error: countErr } = await this.db
      .from('bookings')
      .select('id', { head: true, count: 'exact' })
      .eq('client_id', clientId)
      .lt('scheduled_at', nowIso);

    if (countErr) throw new InternalServerErrorException('Failed to count past bookings');

    const totalBookings = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalBookings / limit));
    const startIndex = (page - 1) * limit;

    const { data, error } = await this.db
      .from('bookings')
      .select(
        'id, scheduled_at, price_usd, status, barber_id, barber_service_id, duration_minutes',
      )
      .eq('client_id', clientId)
      .lt('scheduled_at', nowIso)
      .order('scheduled_at', { ascending: false })
      .order('id', { ascending: false })
      .range(startIndex, startIndex + limit - 1);

    if (error) throw new InternalServerErrorException('Failed to fetch past bookings');

    const rows = (data ?? []) as {
      id: string;
      scheduled_at: string;
      price_usd: string | number;
      status: string;
      barber_id: string;
      barber_service_id: string | null;
      duration_minutes: number | null;
    }[];

    const [{ barberMap, serviceMap }, reviewedIds, timezoneMap] = await Promise.all([
      this.loadClientBookingRelated(
        rows.map((r) => r.barber_id),
        rows.map((r) => r.barber_service_id).filter((id): id is string => !!id),
      ),
      this.fetchReviewedBookingIds(rows.map((r) => r.id)),
      this.fetchBarberTimezones(rows.map((r) => r.barber_id)),
    ]);

    const bookings: ClientPastBookingDto[] = rows.map((r) => {
      const barber = barberMap.get(r.barber_id);
      const service = r.barber_service_id ? serviceMap.get(r.barber_service_id) : undefined;
      const tz = timezoneMap.get(r.barber_id) ?? 'UTC';
      const local = this.splitLocalDateTime(r.scheduled_at, tz);
      return {
        id: r.id,
        barberName: barber?.full_name ?? 'Unknown',
        barberProfileImage: barber?.profile_photo_url ?? null,
        serviceName: service?.name ?? 'Service',
        appointmentDate: local.date,
        appointmentTime: local.time,
        pricePaid: Number(r.price_usd),
        hasReview: reviewedIds.has(r.id),
      };
    });

    return {
      bookings,
      pagination: {
        currentPage: page,
        totalPages,
        totalBookings,
        limit,
        hasNextPage: page < totalPages,
      },
    };
  }

  private dedupRecurringUpcoming(
    rows: { id: string; scheduled_at: string; recurring_booking_id: string | null }[],
  ): { id: string; scheduled_at: string }[] {
    const seenRecurring = new Set<string>();
    const result: { id: string; scheduled_at: string }[] = [];
    for (const r of rows) {
      if (r.recurring_booking_id) {
        if (seenRecurring.has(r.recurring_booking_id)) continue;
        seenRecurring.add(r.recurring_booking_id);
      }
      result.push({ id: r.id, scheduled_at: r.scheduled_at });
    }
    return result;
  }

  private async hydrateUpcomingBookings(ids: string[]): Promise<ClientUpcomingBookingDto[]> {
    if (ids.length === 0) return [];

    const { data, error } = await this.db
      .from('bookings')
      .select(
        'id, scheduled_at, status, barber_id, barber_service_id, duration_minutes, recurring_booking_id',
      )
      .in('id', ids);

    if (error) throw new InternalServerErrorException('Failed to fetch bookings');

    const rows = (data ?? []) as {
      id: string;
      scheduled_at: string;
      status: string;
      barber_id: string;
      barber_service_id: string | null;
      duration_minutes: number | null;
      recurring_booking_id: string | null;
    }[];

    // Preserve the order of `ids` (which was pre-sorted ascending by date)
    const orderIndex = new Map<string, number>();
    ids.forEach((id, i) => orderIndex.set(id, i));
    rows.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));

    const [{ barberMap, serviceMap }, timezoneMap] = await Promise.all([
      this.loadClientBookingRelated(
        rows.map((r) => r.barber_id),
        rows.map((r) => r.barber_service_id).filter((id): id is string => !!id),
      ),
      this.fetchBarberTimezones(rows.map((r) => r.barber_id)),
    ]);

    return rows.map((r) => {
      const barber = barberMap.get(r.barber_id);
      const service = r.barber_service_id ? serviceMap.get(r.barber_service_id) : undefined;
      const tz = timezoneMap.get(r.barber_id) ?? 'UTC';
      const local = this.splitLocalDateTime(r.scheduled_at, tz);
      return {
        id: r.id,
        barberName: barber?.full_name ?? 'Unknown',
        barberProfileImage: barber?.profile_photo_url ?? null,
        serviceName: service?.name ?? 'Service',
        appointmentDate: local.date,
        appointmentTime: local.time,
        durationMinutes: r.duration_minutes ?? service?.duration_minutes ?? 0,
        status: r.status as BookingStatusDto,
        isRecurring: r.recurring_booking_id !== null,
      };
    });
  }

  private async fetchReviewedBookingIds(bookingIds: string[]): Promise<Set<string>> {
    const reviewed = new Set<string>();
    if (bookingIds.length === 0) return reviewed;

    const { data, error } = await this.db
      .from('reviews')
      .select('booking_id')
      .in('booking_id', bookingIds);

    if (error) throw new InternalServerErrorException('Failed to fetch reviews');
    for (const row of data ?? []) reviewed.add(row.booking_id as string);
    return reviewed;
  }

  private async fetchBarberTimezones(barberIds: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const uniqueIds = Array.from(new Set(barberIds));
    if (uniqueIds.length === 0) return result;

    const { data, error } = await this.db
      .from('barbers')
      .select('user_id, timezone')
      .in('user_id', uniqueIds);

    if (error) throw new InternalServerErrorException('Failed to fetch barber timezones');
    for (const row of data ?? []) {
      result.set(row.user_id as string, (row.timezone as string) ?? 'UTC');
    }
    return result;
  }

  private splitLocalDateTime(utcIso: string, timezone: string): { date: string; time: string } {
    const instant = new Date(utcIso);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(instant);
    const pick = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
    const y = pick('year');
    const mo = pick('month');
    const d = pick('day');
    const h = pick('hour') === '24' ? '00' : pick('hour');
    const mi = pick('minute');
    return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
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

    const [bookingServicesSummary, { barberMap }, reviewResult] = await Promise.all([
      this.loadBookingServicesDetail(row.id),
      this.loadClientBookingRelated([row.barber_id], []),
      this.db
        .from('reviews')
        .select('id, rating, comment, created_at')
        .eq('booking_id', bookingId)
        .maybeSingle(),
    ]);

    if (reviewResult.error) throw new InternalServerErrorException('Failed to fetch review');

    const barber = barberMap.get(row.barber_id);

    const reviewRow = reviewResult.data as
      | { id: string; rating: number; comment: string | null; created_at: string }
      | null;
    const review: ClientBookingReviewDto | null = reviewRow
      ? {
          id: reviewRow.id,
          rating: reviewRow.rating,
          comment: reviewRow.comment ?? null,
          createdAt: new Date(reviewRow.created_at).toISOString(),
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
    // Block duration is the snapshot on the bookings row (slot count × slot
    // duration). Don't sum the per-service service durations — those are
    // display info and may not equal the actual reserved time.
    const totalDurationMinutes = row.duration_minutes ?? 0;

    const booking: ClientBookingDetailDto = {
      id: row.id,
      barber: {
        id: row.barber_id,
        name: barber?.full_name ?? 'Unknown',
        profilePhotoUrl: barber?.profile_photo_url ?? null,
      },
      services: bookingServicesSummary,
      scheduledAt: new Date(row.scheduled_at).toISOString(),
      totalDurationMinutes,
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

  private async loadBookingServicesDetail(
    bookingId: string,
  ): Promise<ClientBookingServiceSummaryDto[]> {
    const { data, error } = await this.db
      .from('booking_services')
      .select(
        'barber_service_id, booking_type, duration_minutes, base_price_usd, slot_type_surcharge_usd, price_usd, sort_order',
      )
      .eq('booking_id', bookingId)
      .order('sort_order', { ascending: true });

    if (error) throw new InternalServerErrorException('Failed to fetch booking services');

    const rows = (data ?? []) as {
      barber_service_id: string;
      booking_type: string;
      duration_minutes: number;
      base_price_usd: string | number;
      slot_type_surcharge_usd: string | number;
      price_usd: string | number;
      sort_order: number;
    }[];

    if (rows.length === 0) return [];

    // booking_services.duration_minutes is the SLOT share (drives the
    // schedule math). For display we surface the service's real duration
    // from barber_services.
    const serviceIds = rows.map((r) => r.barber_service_id);
    const { data: serviceData, error: serviceError } = await this.db
      .from('barber_services')
      .select('id, name, duration_minutes')
      .in('id', serviceIds);

    if (serviceError) throw new InternalServerErrorException('Failed to fetch service names');
    const serviceById = new Map<string, { name: string; duration_minutes: number }>();
    for (const s of (serviceData ?? []) as {
      id: string;
      name: string;
      duration_minutes: number;
    }[]) {
      serviceById.set(s.id, { name: s.name, duration_minutes: s.duration_minutes });
    }

    let offset = 0;
    return rows.map((r) => {
      const startOffsetMinutes = offset;
      offset += r.duration_minutes;
      const svc = serviceById.get(r.barber_service_id);
      return {
        id: r.barber_service_id,
        name: svc?.name ?? 'Service',
        durationMinutes: svc?.duration_minutes ?? r.duration_minutes,
        bookingType: r.booking_type as BookingTypeDto,
        startOffsetMinutes,
        pricing: {
          basePrice: Number(r.base_price_usd),
          additionalCost: Number(r.slot_type_surcharge_usd),
          totalPrice: Number(r.price_usd),
        },
      };
    });
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

    // Fire-and-forget — createAndSendNotification swallows its own errors
    void this.notifyBarberOfBookingCancel(bookingId, clientId);

    return { booking };
  }

  private async notifyBarberOfBookingCancel(
    bookingId: string,
    clientAuthId: string,
  ): Promise<void> {
    const { data } = await this.db
      .from('bookings')
      .select('barber_id')
      .eq('id', bookingId)
      .maybeSingle();
    if (!data) return;

    await this.notificationsService.createAndSendNotification({
      recipientId: data.barber_id as string,
      recipientType: 'barber',
      senderId: clientAuthId,
      type: NotificationTypeDto.CANCELLED_BOOKING,
      bookingId,
    });
  }

  public async previewBooking(
    authUserId: string,
    dto: PreviewBookingDto
  ): Promise<PreviewBookingResponseDto> {
    const ctx = await this.validateBookingSlot(authUserId, dto);

    const preview: BookingPreviewDto = {
      scheduledAt: ctx.scheduledAtUtc.toISOString(),
      totalDurationMinutes: ctx.totalDurationMinutes,
      services: ctx.services.map((s) => this.toServiceSummary(s)),
      pricing: ctx.totalPricing,
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
    const primary = ctx.services[0];

    const { data, error } = await this.db
      .from('bookings')
      .insert({
        barber_id: ctx.barberProfile.user_id,
        client_id: ctx.clientAuthId,
        barber_service_id: primary.service.id,
        service_type: primary.service.service_type,
        booking_type: primary.bookingType,
        scheduled_at: ctx.scheduledAtUtc.toISOString(),
        duration_minutes: ctx.totalDurationMinutes,
        base_price_usd: ctx.totalPricing.basePrice,
        slot_type_surcharge_usd: ctx.totalPricing.additionalCost,
        price_usd: ctx.totalPricing.totalPrice,
        status: initialStatus,
        confirmed_at: initialStatus === 'confirmed' ? nowIso : null,
      })
      .select('id, status, scheduled_at, confirmed_at')
      .single();

    if (error) {
      if (error.code === '23505' || error.code === '23P01') {
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

    // Snapshot one row per service. duration_minutes is the SLOT size (the
    // share of the block this service occupies), not the service's nominal
    // duration — that lives on barber_services and is fetched fresh for
    // display.
    const bookingServiceRows = ctx.services.map((s, idx) => ({
      booking_id: row.id,
      barber_service_id: s.service.id,
      service_type: s.service.service_type,
      booking_type: s.bookingType,
      duration_minutes: ctx.slotDurationMinutes,
      base_price_usd: s.pricing.basePrice,
      slot_type_surcharge_usd: s.pricing.additionalCost,
      price_usd: s.pricing.totalPrice,
      sort_order: idx,
    }));

    const { error: childError } = await this.db
      .from('booking_services')
      .insert(bookingServiceRows);

    if (childError) {
      // Best-effort rollback so the booking row doesn't linger without children
      await this.db.from('bookings').delete().eq('id', row.id);
      throw new InternalServerErrorException('Failed to create booking services');
    }

    const booking: ConfirmedBookingDto = {
      id: row.id,
      status: row.status,
      scheduledAt: new Date(row.scheduled_at).toISOString(),
      totalDurationMinutes: ctx.totalDurationMinutes,
      services: ctx.services.map((s) => this.toServiceSummary(s)),
      pricing: ctx.totalPricing,
      barber: {
        id: ctx.barberProfile.user_id,
        name: ctx.barberProfile.full_name,
      },
      confirmedAt: row.confirmed_at,
    };

    void this.notificationsService.createAndSendNotification({
      recipientId: ctx.barberProfile.user_id,
      recipientType: 'barber',
      senderId: ctx.clientAuthId,
      type: NotificationTypeDto.NEW_BOOKING,
      bookingId: row.id,
    });

    void this.conversationsService.markHasBookingIfConversationExists(
      ctx.barberProfile.user_id,
      ctx.clientAuthId,
    );

    return { booking };
  }

  private toServiceSummary(s: ResolvedBookingService): BookingServiceSummaryDto {
    return {
      id: s.service.id,
      name: s.service.name,
      durationMinutes: s.service.duration_minutes,
      bookingType: s.bookingType,
      startOffsetMinutes: s.startOffsetMinutes,
      pricing: s.pricing,
    };
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

    // 3. Services belong to the barber and are all active; no duplicates allowed.
    const requestedIds = dto.services.map((s) => s.barberServiceId);
    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new BadRequestException('Duplicate services are not allowed in a single booking.');
    }

    const { data: serviceRows, error: serviceError } = await this.db
      .from('barber_services')
      .select(
        'id, barber_id, name, service_type, duration_minutes, regular_price_usd, after_hours_price_usd, day_off_price_usd, is_active'
      )
      .in('id', requestedIds)
      .eq('barber_id', dto.barberId)
      .eq('is_active', true);

    if (serviceError) throw new InternalServerErrorException('Failed to fetch services');

    const serviceById = new Map<string, BarberServiceRow>();
    for (const row of (serviceRows ?? []) as BarberServiceRow[]) {
      serviceById.set(row.id, row);
    }
    if (serviceById.size !== requestedIds.length) {
      throw new NotFoundException('One or more services were not found or inactive for this barber');
    }

    // 4. Derive day-of-week and fetch the schedule for this day.
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

    // 5. Walk the block slice-by-slice. Each service consumes exactly one
    //    grid slot of length `schedule.slot_duration_minutes` — the
    //    service's own `duration_minutes` is metadata only (display).
    const slotStartMinutes = this.timeToMinutes(dto.slotTime);
    const slotStep = schedule.slot_duration_minutes;
    const resolved: ResolvedBookingService[] = [];
    let summedBase = 0;
    let summedSurcharge = 0;
    let summedTotal = 0;

    dto.services.forEach((selection, idx) => {
      const service = serviceById.get(selection.barberServiceId);
      if (!service) {
        throw new NotFoundException('Service not found or inactive for this barber');
      }

      const sliceStart = slotStartMinutes + idx * slotStep;
      const sliceEnd = sliceStart + slotStep;

      this.validateSliceWindow(schedule, selection.bookingType, sliceStart, sliceEnd);

      const pricing = this.resolvePricing(service, selection.bookingType);
      summedBase = Number((summedBase + pricing.basePrice).toFixed(2));
      summedSurcharge = Number((summedSurcharge + pricing.additionalCost).toFixed(2));
      summedTotal = Number((summedTotal + pricing.totalPrice).toFixed(2));

      resolved.push({
        service,
        bookingType: selection.bookingType,
        startOffsetMinutes: idx * slotStep,
        pricing,
      });
    });

    const totalDurationMinutes = dto.services.length * slotStep;

    // 6. Compose the UTC timestamp for the block start
    const scheduledAtUtc = this.composeUtcFromLocal(dto.date, dto.slotTime, barberProfile.timezone);

    // 7. Advance notice check — UTC vs UTC, TZ-safe
    const advanceCutoff = new Date(
      scheduledAtUtc.getTime() - schedule.advance_notice_minutes * 60_000
    );
    if (advanceCutoff.getTime() <= Date.now()) {
      throw new BadRequestException('Advance notice window has passed — please pick a later slot.');
    }

    // 8. Overlap check: no other non-cancelled booking for this barber may
    //    intersect [scheduledAtUtc, scheduledAtUtc + totalDurationMinutes).
    //    The DB-level exclusion constraint catches races; this makes the
    //    error message friendly when the conflict is already visible.
    await this.assertNoOverlap(
      dto.barberId,
      scheduledAtUtc,
      totalDurationMinutes,
    );

    return {
      clientAuthId: authUserId,
      barberProfile,
      services: resolved,
      slotDurationMinutes: slotStep,
      totalDurationMinutes,
      scheduledAtUtc,
      totalPricing: {
        basePrice: summedBase,
        additionalCost: summedSurcharge,
        totalPrice: summedTotal,
      },
    };
  }

  private async assertNoOverlap(
    barberId: string,
    startUtc: Date,
    totalDurationMinutes: number,
  ): Promise<void> {
    const blockEndMs = startUtc.getTime() + totalDurationMinutes * 60_000;
    // Longest individual service duration allowed is 60 min, bounded; grab any
    // non-cancelled booking that starts within [block_end - 4h, block_end) and
    // filter overlaps in-memory. 4h is a safety margin > max block + max
    // service duration.
    const windowStartMs = startUtc.getTime() - 4 * 60 * 60_000;
    const { data, error } = await this.db
      .from('bookings')
      .select('scheduled_at, duration_minutes')
      .eq('barber_id', barberId)
      .neq('status', 'cancelled')
      .gte('scheduled_at', new Date(windowStartMs).toISOString())
      .lt('scheduled_at', new Date(blockEndMs).toISOString());

    if (error) throw new InternalServerErrorException('Failed to check slot availability');

    for (const row of data ?? []) {
      const existingStart = new Date(row.scheduled_at as string).getTime();
      const existingDuration = (row.duration_minutes as number | null) ?? 0;
      const existingEnd = existingStart + existingDuration * 60_000;
      if (existingEnd > startUtc.getTime() && existingStart < blockEndMs) {
        throw new ConflictException('This slot is already booked.');
      }
    }
  }

  private validateSliceWindow(
    schedule: BarberScheduleRow,
    bookingType: BookingTypeDto,
    sliceStartMinutes: number,
    sliceEndMinutes: number,
  ): void {
    if (bookingType === BookingTypeDto.REGULAR) {
      if (!schedule.is_working) {
        throw new BadRequestException('Barber is not working on this day for regular bookings.');
      }
      if (!schedule.regular_start_time || !schedule.regular_end_time) {
        throw new BadRequestException('Regular hours are not configured for this day.');
      }
      this.assertSliceWithinWindow(
        sliceStartMinutes,
        sliceEndMinutes,
        schedule.regular_start_time,
        schedule.regular_end_time,
        'regular',
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
      this.assertSliceWithinWindow(
        sliceStartMinutes,
        sliceEndMinutes,
        schedule.after_hours_start,
        schedule.after_hours_end,
        'after_hours',
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
    this.assertSliceWithinWindow(
      sliceStartMinutes,
      sliceEndMinutes,
      schedule.day_off_start_time,
      schedule.day_off_end_time,
      'day_off',
    );
  }

  private assertSliceWithinWindow(
    sliceStart: number,
    sliceEnd: number,
    windowStart: string,
    windowEnd: string,
    typeLabel: string,
  ): void {
    const start = this.timeToMinutes(windowStart);
    const end = this.timeToMinutes(windowEnd);
    if (sliceStart < start || sliceEnd > end) {
      throw new BadRequestException(
        `A ${typeLabel} service in this booking does not fit inside the ${typeLabel} window for this day.`,
      );
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

    // Fall back to the regular price when the service has no explicit
    // after_hours / day_off pricing — the slot is still bookable, no surcharge.
    if (typePriceRaw === null || typePriceRaw === undefined) {
      return { basePrice, additionalCost: 0, totalPrice: basePrice };
    }

    const totalPrice = Number(typePriceRaw);
    const additionalCost = Number((totalPrice - basePrice).toFixed(2));

    return { basePrice, additionalCost, totalPrice };
  }
}
