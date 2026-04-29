import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { BookingTypeDto } from '../../bookings/dto/preview-booking.dto';
import { BookingStatusDto } from '../dto/list-barber-bookings-query.dto';
import {
  BarberClientsOrderDto,
  BarberClientsSortDto,
  ListBarberClientsQueryDto,
} from './dto/list-barber-clients-query.dto';
import {
  BarberClientListItemDto,
  BarberClientsPageMetaDto,
  ListBarberClientsResponseDto,
} from './dto/barber-client-list-item.dto';
import {
  BarberClientBookingDto,
  BarberClientBookingServiceDto,
  BarberClientDetailDto,
  BarberClientPastBookingsDto,
  BarberClientRecurringSeriesDto,
} from './dto/barber-client-detail.dto';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const DEFAULT_PAST_PAGE = 1;
const DEFAULT_PAST_LIMIT = 10;
const MAX_PAST_LIMIT = 50;

const RECURRING_ACTIVE_STATUSES = new Set(['active', 'pending_barber_approval', 'paused']);

interface RpcListItem {
  clientId: string;
  name: string;
  profilePhotoUrl: string | null;
  email: string | null;
  totalVisits: number;
  totalSpendUsd: number | string;
  firstVisitAt: string | null;
  lastVisitAt: string | null;
  nextBookingAt: string | null;
  hasUpcoming: boolean;
}

interface RpcListResult {
  total: number;
  items: RpcListItem[];
}

interface RpcDetailResult {
  profile: {
    id: string;
    name: string;
    profilePhotoUrl: string | null;
    email: string | null;
    createdAt: string | null;
  };
  totalVisits: number;
  totalSpendUsd: number | string;
  firstVisitAt: string | null;
  lastVisitAt: string | null;
  noShowCount: number;
  cancellationCount: number;
  nextBookingAt: string | null;
  favouriteService: { id: string; name: string } | null;
}

interface BookingRow {
  id: string;
  scheduled_at: string;
  status: string;
  booking_type: string;
  duration_minutes: number | null;
  price_usd: string | number;
  recurring_booking_id: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
}

interface BookingServiceRow {
  booking_id: string;
  barber_service_id: string;
  booking_type: string;
  duration_minutes: number;
  price_usd: string | number;
  sort_order: number;
}

interface BarberServiceLite {
  id: string;
  name: string;
  duration_minutes: number;
}

interface RecurringRow {
  id: string;
  day_of_week: number;
  slot_time: string;
  frequency: 'weekly' | 'biweekly';
  status: string;
  price_usd: string | number;
  barber_service_id: string;
  created_at: string;
  barber_accepted_at: string | null;
  cancelled_at: string | null;
}

@Injectable()
export class BarberClientsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  // ────────────────────────────────────────────────────────────
  // GET /barber/clients
  // ────────────────────────────────────────────────────────────

  public async listClients(
    barberId: string,
    query: ListBarberClientsQueryDto
  ): Promise<ListBarberClientsResponseDto> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = (page - 1) * limit;

    const { data, error } = await this.db.rpc('get_barber_clients', {
      p_barber_id: barberId,
      p_search: query.search ?? null,
      p_sort_by: query.sortBy ?? BarberClientsSortDto.LAST_VISIT,
      p_order: query.order ?? BarberClientsOrderDto.DESC,
      p_offset: offset,
      p_limit: limit,
      p_has_upcoming: query.hasUpcoming ?? false,
    });

    if (error) throw new InternalServerErrorException('Failed to fetch clients');

    const result = (data ?? { total: 0, items: [] }) as RpcListResult;
    const totalClients = result.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalClients / limit));

    const clients: BarberClientListItemDto[] = (result.items ?? []).map((row) => ({
      clientId: row.clientId,
      name: row.name,
      profilePhotoUrl: row.profilePhotoUrl,
      email: row.email,
      totalVisits: Number(row.totalVisits ?? 0),
      totalSpendUsd: Number(row.totalSpendUsd ?? 0),
      firstVisitAt: row.firstVisitAt ? new Date(row.firstVisitAt).toISOString() : null,
      lastVisitAt: row.lastVisitAt ? new Date(row.lastVisitAt).toISOString() : null,
      nextBookingAt: row.nextBookingAt ? new Date(row.nextBookingAt).toISOString() : null,
      hasUpcoming: Boolean(row.hasUpcoming),
      // No guest/walk-in support exists in the schema (bookings.client_id is
      // a NOT NULL FK to auth.users). Always false; documented on the DTO.
      isGuest: false,
    }));

    const pagination: BarberClientsPageMetaDto = {
      currentPage: page,
      totalPages,
      limit,
      hasNextPage: page < totalPages,
      totalClients,
    };

    return { clients, pagination };
  }

  // ────────────────────────────────────────────────────────────
  // GET /barber/clients/:clientId
  // ────────────────────────────────────────────────────────────

  public async getClientDetail(
    barberId: string,
    clientId: string,
    pastPageRaw?: number,
    pastLimitRaw?: number
  ): Promise<BarberClientDetailDto> {
    const pastPage = pastPageRaw ?? DEFAULT_PAST_PAGE;
    const pastLimit = Math.min(pastLimitRaw ?? DEFAULT_PAST_LIMIT, MAX_PAST_LIMIT);

    const { data: rpcData, error: rpcError } = await this.db.rpc('get_barber_client_detail', {
      p_barber_id: barberId,
      p_client_id: clientId,
    });
    if (rpcError) throw new InternalServerErrorException('Failed to fetch client detail');

    // RPC returns NULL when no non-cancelled booking exists between this
    // barber and this client. Surface as 404 — the spec is explicit that we
    // never leak existence with a 403.
    if (!rpcData) throw new NotFoundException('Client not found');

    const detail = rpcData as RpcDetailResult;

    const [upcomingBookings, pastBookings, recurringSeries] = await Promise.all([
      this.fetchUpcomingBookings(barberId, clientId),
      this.fetchPastBookings(barberId, clientId, pastPage, pastLimit),
      this.fetchRecurringSeries(barberId, clientId),
    ]);

    const totalVisits = Number(detail.totalVisits ?? 0);
    const totalSpendUsd = Number(detail.totalSpendUsd ?? 0);
    const averageSpendUsd = totalVisits > 0 ? Number((totalSpendUsd / totalVisits).toFixed(2)) : 0;

    return {
      client: {
        id: detail.profile?.id ?? clientId,
        name: detail.profile?.name ?? 'Unknown',
        profilePhotoUrl: detail.profile?.profilePhotoUrl ?? null,
        email: detail.profile?.email ?? null,
        createdAt: detail.profile?.createdAt
          ? new Date(detail.profile.createdAt).toISOString()
          : null,
        isGuest: false,
      },
      stats: {
        totalVisits,
        totalSpendUsd,
        averageSpendUsd,
        firstVisitAt: detail.firstVisitAt ? new Date(detail.firstVisitAt).toISOString() : null,
        lastVisitAt: detail.lastVisitAt ? new Date(detail.lastVisitAt).toISOString() : null,
        noShowCount: Number(detail.noShowCount ?? 0),
        cancellationCount: Number(detail.cancellationCount ?? 0),
        favouriteService: detail.favouriteService ?? null,
      },
      upcomingBookings,
      pastBookings,
      recurringSeries,
    };
  }

  // ────────────────────────────────────────────────────────────
  // Booking hydration
  // ────────────────────────────────────────────────────────────

  private async fetchUpcomingBookings(
    barberId: string,
    clientId: string
  ): Promise<BarberClientBookingDto[]> {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.db
      .from('bookings')
      .select(
        'id, scheduled_at, status, booking_type, duration_minutes, price_usd, recurring_booking_id, cancelled_at, cancelled_by'
      )
      .eq('barber_id', barberId)
      .eq('client_id', clientId)
      .in('status', ['pending', 'confirmed'])
      .gte('scheduled_at', nowIso)
      .order('scheduled_at', { ascending: true })
      .order('id', { ascending: true });

    if (error) throw new InternalServerErrorException('Failed to fetch upcoming bookings');

    return this.hydrateBookings((data ?? []) as BookingRow[]);
  }

  private async fetchPastBookings(
    barberId: string,
    clientId: string,
    page: number,
    limit: number
  ): Promise<BarberClientPastBookingsDto> {
    const nowIso = new Date().toISOString();

    const { count, error: countErr } = await this.db
      .from('bookings')
      .select('id', { head: true, count: 'exact' })
      .eq('barber_id', barberId)
      .eq('client_id', clientId)
      .lt('scheduled_at', nowIso);

    if (countErr) throw new InternalServerErrorException('Failed to count past bookings');

    const totalBookings = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalBookings / limit));
    const startIndex = (page - 1) * limit;

    const { data, error } = await this.db
      .from('bookings')
      .select(
        'id, scheduled_at, status, booking_type, duration_minutes, price_usd, recurring_booking_id, cancelled_at, cancelled_by'
      )
      .eq('barber_id', barberId)
      .eq('client_id', clientId)
      .lt('scheduled_at', nowIso)
      .order('scheduled_at', { ascending: false })
      .order('id', { ascending: false })
      .range(startIndex, startIndex + limit - 1);

    if (error) throw new InternalServerErrorException('Failed to fetch past bookings');

    const items = await this.hydrateBookings((data ?? []) as BookingRow[]);

    return {
      items,
      pagination: {
        currentPage: page,
        totalPages,
        limit,
        hasNextPage: page < totalPages,
        totalBookings,
      },
    };
  }

  private async hydrateBookings(rows: BookingRow[]): Promise<BarberClientBookingDto[]> {
    if (rows.length === 0) return [];

    const bookingIds = rows.map((r) => r.id);

    const { data: serviceRows, error: serviceErr } = await this.db
      .from('booking_services')
      .select(
        'booking_id, barber_service_id, booking_type, duration_minutes, price_usd, sort_order'
      )
      .in('booking_id', bookingIds)
      .order('sort_order', { ascending: true });

    if (serviceErr) throw new InternalServerErrorException('Failed to fetch booking services');
    const services = (serviceRows ?? []) as BookingServiceRow[];

    const serviceIds = Array.from(new Set(services.map((s) => s.barber_service_id)));
    const serviceMap = await this.fetchBarberServices(serviceIds);

    const byBookingId = new Map<string, BookingServiceRow[]>();
    for (const s of services) {
      const list = byBookingId.get(s.booking_id) ?? [];
      list.push(s);
      byBookingId.set(s.booking_id, list);
    }

    return rows.map((row) => {
      const childRows = byBookingId.get(row.id) ?? [];
      const childServices: BarberClientBookingServiceDto[] = childRows.map((s) => {
        const meta = serviceMap.get(s.barber_service_id);
        return {
          id: s.barber_service_id,
          name: meta?.name ?? 'Service',
          // Surface the service's nominal duration from barber_services.
          // booking_services.duration_minutes is the SLOT share — used for
          // schedule math, not display.
          durationMinutes: meta?.duration_minutes ?? s.duration_minutes,
          bookingType: s.booking_type as BookingTypeDto,
          priceUsd: Number(s.price_usd),
        };
      });

      return {
        id: row.id,
        status: row.status as BookingStatusDto,
        scheduledAt: new Date(row.scheduled_at).toISOString(),
        totalDurationMinutes: row.duration_minutes ?? 0,
        bookingType: row.booking_type as BookingTypeDto,
        services: childServices,
        totalPriceUsd: Number(row.price_usd),
        isRecurring: row.recurring_booking_id !== null,
        recurringBookingId: row.recurring_booking_id,
        cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
        cancelledBy: (row.cancelled_by as 'client' | 'barber' | null) ?? null,
      };
    });
  }

  private async fetchBarberServices(serviceIds: string[]): Promise<Map<string, BarberServiceLite>> {
    const map = new Map<string, BarberServiceLite>();
    if (serviceIds.length === 0) return map;

    const { data, error } = await this.db
      .from('barber_services')
      .select('id, name, duration_minutes')
      .in('id', serviceIds);

    if (error) throw new InternalServerErrorException('Failed to fetch services');

    for (const s of (data ?? []) as BarberServiceLite[]) {
      map.set(s.id, s);
    }
    return map;
  }

  // ────────────────────────────────────────────────────────────
  // Recurring series — parent contracts only (Option A: occurrences
  // are already materialised in `bookings` and surfaced via
  // upcomingBookings / pastBookings).
  // ────────────────────────────────────────────────────────────

  private async fetchRecurringSeries(
    barberId: string,
    clientId: string
  ): Promise<BarberClientRecurringSeriesDto[]> {
    const { data, error } = await this.db
      .from('recurring_bookings')
      .select(
        'id, day_of_week, slot_time, frequency, status, price_usd, barber_service_id, created_at, barber_accepted_at, cancelled_at'
      )
      .eq('barber_id', barberId)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) throw new InternalServerErrorException('Failed to fetch recurring series');

    const rows = (data ?? []) as RecurringRow[];
    if (rows.length === 0) return [];

    const serviceMap = await this.fetchBarberServices(
      Array.from(new Set(rows.map((r) => r.barber_service_id)))
    );
    const nextOccurrenceMap = await this.fetchNextRecurringOccurrences(rows.map((r) => r.id));

    return rows.map((row) => {
      const svc = serviceMap.get(row.barber_service_id);
      return {
        id: row.id,
        dayOfWeek: row.day_of_week,
        slotTime: row.slot_time.substring(0, 5),
        frequency: row.frequency,
        status: row.status as BarberClientRecurringSeriesDto['status'],
        active: RECURRING_ACTIVE_STATUSES.has(row.status),
        priceUsd: Number(row.price_usd),
        service: { id: row.barber_service_id, name: svc?.name ?? 'Service' },
        nextOccurrenceAt: nextOccurrenceMap.get(row.id) ?? null,
        startedAt: new Date(row.barber_accepted_at ?? row.created_at).toISOString(),
        cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
      };
    });
  }

  private async fetchNextRecurringOccurrences(
    recurringIds: string[]
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (recurringIds.length === 0) return result;

    const nowIso = new Date().toISOString();
    const { data, error } = await this.db
      .from('bookings')
      .select('recurring_booking_id, scheduled_at')
      .in('recurring_booking_id', recurringIds)
      .in('status', ['pending', 'confirmed'])
      .gte('scheduled_at', nowIso)
      .order('scheduled_at', { ascending: true });

    if (error) throw new InternalServerErrorException('Failed to fetch next occurrences');

    for (const row of data ?? []) {
      const id = row.recurring_booking_id as string;
      if (!result.has(id)) {
        result.set(id, new Date(row.scheduled_at as string).toISOString());
      }
    }
    return result;
  }
}
