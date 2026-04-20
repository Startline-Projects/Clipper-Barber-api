import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { BookingCompletionService } from '../bookings/booking-completion.service';
import { BookingTypeDto } from '../bookings/dto/preview-booking.dto';
import {
  BookingStatusDto,
  BookingTimeframeDto,
  BookingTypeFilterDto,
  ListBarberBookingsQueryDto,
} from './dto/list-barber-bookings-query.dto';
import {
  BarberBookingListItemDto,
  BarberBookingsListResponseDto,
} from './dto/barber-booking-list-item.dto';
import {
  BarberBookingDetailDto,
  BarberBookingDetailResponseDto,
} from './dto/barber-booking-detail.dto';
import { ConfirmBarberBookingResponseDto } from './dto/confirm-booking-response.dto';
import { CancelBarberBookingResponseDto } from './dto/cancel-barber-booking-response.dto';
import { CompleteBookingResponseDto } from './dto/complete-booking-response.dto';
import { NoShowBookingResponseDto } from './dto/no-show-response.dto';
import { AutoConfirmSettingsResponseDto } from './dto/auto-confirm-settings-response.dto';
import { RecurringEnabledResponseDto } from './dto/update-recurring-enabled.dto';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const LIST_SELECT = `
  id, scheduled_at, booking_type, price_usd, status, created_at,
  duration_minutes, recurring_booking_id,
  barber_service_id,
  client_id
`;

const DETAIL_SELECT = `
  id, scheduled_at, booking_type, status, created_at,
  duration_minutes, recurring_booking_id,
  base_price_usd, slot_type_surcharge_usd, price_usd,
  confirmed_at, cancelled_at, cancelled_by,
  no_show_charged, no_show_charge_amount_usd,
  barber_service_id, client_id
`;

interface BookingRowForList {
  id: string;
  scheduled_at: string;
  booking_type: string;
  price_usd: string | number;
  status: string;
  created_at: string;
  duration_minutes: number | null;
  recurring_booking_id: string | null;
  barber_service_id: string | null;
  client_id: string;
}

interface BookingRowForDetail {
  id: string;
  scheduled_at: string;
  booking_type: string;
  status: string;
  created_at: string;
  duration_minutes: number | null;
  recurring_booking_id: string | null;
  base_price_usd: string | number | null;
  slot_type_surcharge_usd: string | number | null;
  price_usd: string | number;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  no_show_charged: boolean;
  no_show_charge_amount_usd: string | number | null;
  barber_service_id: string | null;
  client_id: string;
}

interface ClientLite {
  user_id: string;
  name: string;
  profile_photo_url: string | null;
}

interface ServiceLite {
  id: string;
  name: string;
  duration_minutes: number;
}

@Injectable()
export class BarbersService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly completionService: BookingCompletionService
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  // ────────────────────────────────────────────────────────────
  // Barber bookings — list / detail
  // ────────────────────────────────────────────────────────────

  public async listBookings(
    barberId: string,
    query: ListBarberBookingsQueryDto
  ): Promise<BarberBookingsListResponseDto> {
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const nowIso = new Date().toISOString();
    const ascending = query.timeframe === BookingTimeframeDto.UPCOMING;

    const cursorRow = await this.resolveCursor(barberId, query.cursor);

    let q = this.db.from('bookings').select(LIST_SELECT).eq('barber_id', barberId);

    if (query.timeframe === BookingTimeframeDto.UPCOMING) {
      q = q.in('status', ['pending', 'confirmed']).gte('scheduled_at', nowIso);
    } else {
      q = q.or(`status.in.(completed,cancelled,no_show),scheduled_at.lt.${nowIso}`);
    }

    if (query.bookingType) q = q.eq('booking_type', query.bookingType);
    if (query.status) q = q.eq('status', query.status);

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

    const rows = (data ?? []) as BookingRowForList[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const { clientMap, serviceMap } = await this.loadRelated(
      pageRows.map((r) => r.client_id),
      pageRows.map((r) => r.barber_service_id).filter((id): id is string => !!id)
    );

    const bookings: BarberBookingListItemDto[] = pageRows.map((r) => {
      const client = clientMap.get(r.client_id);
      const service = r.barber_service_id ? serviceMap.get(r.barber_service_id) : undefined;
      return {
        id: r.id,
        client: {
          id: r.client_id,
          name: client?.name ?? 'Unknown',
          profilePhotoUrl: client?.profile_photo_url ?? null,
        },
        service: {
          name: service?.name ?? 'Service',
          durationMinutes: service?.duration_minutes ?? r.duration_minutes ?? 0,
        },
        scheduledAt: new Date(r.scheduled_at).toISOString(),
        bookingType: r.booking_type as BookingTypeDto,
        totalPrice: Number(r.price_usd),
        status: r.status as BookingStatusDto,
        isRecurring: r.recurring_booking_id !== null,
        recurringBookingId: r.recurring_booking_id,
        createdAt: new Date(r.created_at).toISOString(),
      };
    });

    return {
      bookings,
      nextCursor: hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
      hasMore,
    };
  }

  public async getBookingDetail(
    barberId: string,
    bookingId: string
  ): Promise<BarberBookingDetailResponseDto> {
    const { data, error } = await this.db
      .from('bookings')
      .select(DETAIL_SELECT)
      .eq('id', bookingId)
      .eq('barber_id', barberId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to fetch booking');
    if (!data) throw new NotFoundException('Booking not found');

    const row = data as BookingRowForDetail;

    const { clientMap, serviceMap } = await this.loadRelated(
      [row.client_id],
      row.barber_service_id ? [row.barber_service_id] : []
    );

    // TODO: attach full booking history count for this client once the
    // client-stats helper is extracted.
    const client = clientMap.get(row.client_id);
    const service = row.barber_service_id ? serviceMap.get(row.barber_service_id) : undefined;

    const { count: reviewCount, error: reviewError } = await this.db
      .from('reviews')
      .select('id', { head: true, count: 'exact' })
      .eq('booking_id', bookingId);

    if (reviewError) throw new InternalServerErrorException('Failed to check review');

    const basePrice =
      row.base_price_usd !== null && row.base_price_usd !== undefined
        ? Number(row.base_price_usd)
        : Number(row.price_usd);
    const additionalCost =
      row.slot_type_surcharge_usd !== null && row.slot_type_surcharge_usd !== undefined
        ? Number(row.slot_type_surcharge_usd)
        : 0;
    const totalPrice = Number(row.price_usd);

    const booking: BarberBookingDetailDto = {
      id: row.id,
      client: {
        id: row.client_id,
        name: client?.name ?? 'Unknown',
        profilePhotoUrl: client?.profile_photo_url ?? null,
      },
      service: {
        name: service?.name ?? 'Service',
        durationMinutes: service?.duration_minutes ?? row.duration_minutes ?? 0,
      },
      scheduledAt: new Date(row.scheduled_at).toISOString(),
      bookingType: row.booking_type as BookingTypeDto,
      status: row.status as BookingStatusDto,
      pricing: { basePrice, additionalCost, totalPrice },
      confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
      cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
      cancelledBy: (row.cancelled_by as 'client' | 'barber' | null) ?? null,
      noShowCharged: row.no_show_charged,
      noShowChargeAmountUsd:
        row.no_show_charge_amount_usd !== null && row.no_show_charge_amount_usd !== undefined
          ? Number(row.no_show_charge_amount_usd)
          : null,
      reviewLeftByClient: (reviewCount ?? 0) > 0,
      isRecurring: row.recurring_booking_id !== null,
      recurringBookingId: row.recurring_booking_id,
      createdAt: new Date(row.created_at).toISOString(),
    };

    return { booking };
  }

  // ────────────────────────────────────────────────────────────
  // Barber bookings — state transitions
  // ────────────────────────────────────────────────────────────

  public async confirmBooking(
    barberId: string,
    bookingId: string
  ): Promise<ConfirmBarberBookingResponseDto> {
    const existing = await this.fetchBookingForBarber(barberId, bookingId, 'id, status');
    const status = existing.status as string;
    if (status === 'confirmed') throw new BadRequestException('Booking is already confirmed.');
    if (status !== 'pending') throw new BadRequestException('Cannot confirm this booking.');

    const confirmedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await this.db
      .from('bookings')
      .update({ status: 'confirmed', confirmed_at: confirmedAt })
      .eq('id', bookingId)
      .eq('barber_id', barberId)
      .eq('status', 'pending')
      .select('id, status, confirmed_at')
      .single();

    if (updateError || !updated) {
      throw new InternalServerErrorException('Failed to confirm booking');
    }

    return {
      booking: {
        id: updated.id as string,
        status: updated.status as string,
        confirmedAt: new Date(updated.confirmed_at as string).toISOString(),
      },
    };
  }

  public async cancelBooking(
    barberId: string,
    bookingId: string
  ): Promise<CancelBarberBookingResponseDto> {
    const existing = await this.fetchBookingForBarber(barberId, bookingId, 'id, status');
    const status = existing.status as string;
    if (status === 'cancelled') throw new BadRequestException('Booking is already cancelled.');
    if (status === 'completed' || status === 'no_show') {
      throw new BadRequestException('Cannot cancel a completed booking.');
    }

    const cancelledAt = new Date().toISOString();
    const { data: updated, error: updateError } = await this.db
      .from('bookings')
      .update({
        status: 'cancelled',
        cancelled_at: cancelledAt,
        cancelled_by: 'barber',
      })
      .eq('id', bookingId)
      .eq('barber_id', barberId)
      .in('status', ['pending', 'confirmed'])
      .select('id, status, cancelled_at, cancelled_by')
      .single();

    if (updateError || !updated) {
      throw new InternalServerErrorException('Failed to cancel booking');
    }

    return {
      booking: {
        id: updated.id as string,
        status: updated.status as string,
        cancelledAt: new Date(updated.cancelled_at as string).toISOString(),
        cancelledBy: 'barber',
      },
    };
  }

  public async completeBookingManual(
    barberId: string,
    bookingId: string
  ): Promise<CompleteBookingResponseDto> {
    const existing = await this.fetchBookingForBarber(barberId, bookingId, 'id, status');
    const status = existing.status as string;
    if (status === 'pending') throw new BadRequestException('Confirm the booking first.');
    if (status === 'completed') throw new BadRequestException('Booking is already completed.');
    if (status === 'cancelled' || status === 'no_show') {
      throw new BadRequestException('Cannot complete this booking.');
    }

    const completed = await this.completionService.completeBooking(bookingId, barberId);
    return { booking: { id: completed.id, status: completed.status } };
  }

  public async markNoShow(
    barberId: string,
    bookingId: string
  ): Promise<NoShowBookingResponseDto> {
    const existing = await this.fetchBookingForBarber(
      barberId,
      bookingId,
      'id, status, scheduled_at, duration_minutes'
    );
    const status = existing.status as string;
    if (status === 'no_show') throw new BadRequestException('Booking is already marked as no-show.');
    if (status === 'pending') throw new BadRequestException('Cannot mark a pending booking as no-show.');
    if (status === 'cancelled') throw new BadRequestException('Cannot mark a cancelled booking as no-show.');
    if (status !== 'confirmed' && status !== 'completed') {
      throw new BadRequestException('Only confirmed or completed bookings can be marked as no-show.');
    }

    const scheduledAt = new Date(existing.scheduled_at as string);
    const duration = (existing.duration_minutes as number | null) ?? 0;
    const windowEndMs = scheduledAt.getTime() + duration * 60_000;
    if (windowEndMs > Date.now()) {
      throw new BadRequestException("Appointment window hasn't ended yet.");
    }

    const { data: updated, error: updateError } = await this.db
      .from('bookings')
      .update({ status: 'no_show' })
      .eq('id', bookingId)
      .eq('barber_id', barberId)
      .in('status', ['confirmed', 'completed'])
      .select('id, status')
      .single();

    if (updateError || !updated) {
      throw new InternalServerErrorException('Failed to mark booking as no-show');
    }

    return {
      booking: {
        id: updated.id as string,
        status: updated.status as string,
      },
    };
  }

  // ────────────────────────────────────────────────────────────
  // Barber settings — auto-confirm flags
  // ────────────────────────────────────────────────────────────

  public async updateAllowAutoConfirm(
    barberId: string,
    enabled: boolean
  ): Promise<AutoConfirmSettingsResponseDto> {
    return this.updateAutoConfirmFlag(barberId, { allow_auto_confirm: enabled });
  }

  public async updateAutoConfirmToday(
    barberId: string,
    enabled: boolean
  ): Promise<AutoConfirmSettingsResponseDto> {
    return this.updateAutoConfirmFlag(barberId, { auto_confirm_today: enabled });
  }

  public async updateRecurringEnabled(
    barberId: string,
    enabled: boolean
  ): Promise<RecurringEnabledResponseDto> {
    const { data, error } = await this.db
      .from('barbers')
      .update({ recurring_enabled: enabled })
      .eq('user_id', barberId)
      .select('recurring_enabled')
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to update recurring flag');
    if (!data) throw new NotFoundException('Barber profile not found');

    return { recurringEnabled: data.recurring_enabled as boolean };
  }

  // ────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────

  private async fetchBookingForBarber(
    barberId: string,
    bookingId: string,
    columns: string
  ): Promise<Record<string, unknown>> {
    const { data, error } = await this.db
      .from('bookings')
      .select(columns)
      .eq('id', bookingId)
      .eq('barber_id', barberId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to fetch booking');
    if (!data) throw new NotFoundException('Booking not found');
    return data as unknown as Record<string, unknown>;
  }

  private async resolveCursor(
    barberId: string,
    cursor?: string
  ): Promise<{ id: string; scheduled_at: string } | null> {
    if (!cursor) return null;
    const { data, error } = await this.db
      .from('bookings')
      .select('id, scheduled_at')
      .eq('id', cursor)
      .eq('barber_id', barberId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to resolve cursor');
    if (!data) return null;
    return { id: data.id as string, scheduled_at: data.scheduled_at as string };
  }

  private async updateAutoConfirmFlag(
    barberId: string,
    patch: { allow_auto_confirm?: boolean; auto_confirm_today?: boolean }
  ): Promise<AutoConfirmSettingsResponseDto> {
    const { data, error } = await this.db
      .from('barbers')
      .update(patch)
      .eq('user_id', barberId)
      .select('allow_auto_confirm, auto_confirm_today')
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to update settings');
    if (!data) throw new NotFoundException('Barber profile not found');

    return {
      allowAutoConfirm: data.allow_auto_confirm as boolean,
      autoConfirmToday: data.auto_confirm_today as boolean,
    };
  }

  private async loadRelated(
    clientIds: string[],
    serviceIds: string[]
  ): Promise<{
    clientMap: Map<string, ClientLite>;
    serviceMap: Map<string, ServiceLite>;
  }> {
    const clientMap = new Map<string, ClientLite>();
    const serviceMap = new Map<string, ServiceLite>();

    const uniqueClientIds = Array.from(new Set(clientIds));
    if (uniqueClientIds.length > 0) {
      const { data, error } = await this.db
        .from('clients')
        .select('user_id, name, profile_photo_url')
        .in('user_id', uniqueClientIds);
      if (error) throw new InternalServerErrorException('Failed to fetch clients');
      for (const c of data ?? []) {
        clientMap.set(c.user_id as string, {
          user_id: c.user_id as string,
          name: c.name as string,
          profile_photo_url: (c.profile_photo_url as string | null) ?? null,
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

    return { clientMap, serviceMap };
  }
}
