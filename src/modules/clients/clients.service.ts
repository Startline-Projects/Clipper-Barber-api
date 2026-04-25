import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  BarberSortDto,
  GetBarberDetailQueryDto,
  ListBarbersQueryDto,
  RecurringFilterDto,
} from './dto/list-barbers-query.dto';
import {
  BarberListItemDto,
  BarberTopServiceDto,
  ListBarbersResponseDto,
} from './dto/barber-list-item.dto';
import {
  BarberDetailResponseDto,
  BarberDetailReviewDto,
  BarberDetailServiceDto,
  BarberWorkingDayDto,
} from './dto/barber-detail-response.dto';
import { ServiceType } from '../barbers/services/dto/create-barber-service.dto';
import { buildDistance, haversineKm } from './utils/distance.util';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const TOP_SERVICES_LIMIT = 3;
const REVIEWS_LIMIT = 7;

interface BarberRow {
  user_id: string;
  full_name: string;
  profile_photo_url: string | null;
  bio: string | null;
  phone: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  average_rating: number | string | null;
  total_reviews: number | null;
  recurring_enabled: boolean;
  onboarding_complete: boolean;
}

interface BarberServiceRow {
  id: string;
  barber_id: string;
  name: string;
  service_type: string;
  duration_minutes: number;
  regular_price_usd: number | string;
  sort_order: number;
}

interface ScheduleRow {
  barber_id: string;
  day_of_week: number;
  is_working: boolean;
  regular_start_time: string | null;
  regular_end_time: string | null;
}

interface ReviewRow {
  id: string;
  client_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

interface ClientLite {
  user_id: string;
  name: string;
  profile_photo_url: string | null;
}

@Injectable()
export class ClientsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  public async listBarbersForClient(
    query: ListBarbersQueryDto,
  ): Promise<ListBarbersResponseDto> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const sort = query.sort ?? BarberSortDto.NEAREST;

    const matchingBarberIdsFromService = await this.resolveServiceSearchBarberIds(query.search);

    const barbers = await this.fetchBarbersFiltered(query, matchingBarberIdsFromService);

    const withDistance = barbers
      .filter((b) => b.latitude !== null && b.longitude !== null)
      .map((b) => {
        const lat = Number(b.latitude);
        const lon = Number(b.longitude);
        return {
          row: b,
          distanceKm: haversineKm(query.latitude, query.longitude, lat, lon),
        };
      });

    const sorted = this.sortBarbers(withDistance, sort);

    const totalBarbers = sorted.length;
    const totalPages = Math.max(1, Math.ceil(totalBarbers / limit));
    const startIndex = (page - 1) * limit;
    const pageSlice = sorted.slice(startIndex, startIndex + limit);

    const topServicesByBarber = await this.fetchTopServices(pageSlice.map((p) => p.row.user_id));

    const items: BarberListItemDto[] = pageSlice.map(({ row, distanceKm }) => ({
      id: row.user_id,
      name: row.full_name,
      profileImage: row.profile_photo_url,
      averageRating: row.average_rating !== null ? Number(row.average_rating) : 0,
      totalReviews: row.total_reviews ?? 0,
      distance: buildDistance(distanceKm),
      recurringAvailable: row.recurring_enabled,
      topServices: topServicesByBarber.get(row.user_id) ?? [],
    }));

    return {
      barbers: items,
      pagination: {
        currentPage: page,
        totalPages,
        totalBarbers,
        limit,
        hasNextPage: page < totalPages,
      },
    };
  }

  public async getBarberDetail(
    barberId: string,
    query: GetBarberDetailQueryDto,
  ): Promise<BarberDetailResponseDto> {
    const { data: barberData, error: barberError } = await this.db
      .from('barbers')
      .select(
        'user_id, full_name, profile_photo_url, bio, phone, street_address, city, state, zip_code, latitude, longitude, average_rating, total_reviews, recurring_enabled, onboarding_complete',
      )
      .eq('user_id', barberId)
      .eq('onboarding_complete', true)
      .maybeSingle();

    if (barberError) throw new InternalServerErrorException('Failed to fetch barber');
    if (!barberData) throw new NotFoundException('Barber not found');

    const barber = barberData as BarberRow;

    const [services, schedules, reviews] = await Promise.all([
      this.fetchAllServicesForBarber(barberId),
      this.fetchSchedulesForBarber(barberId),
      this.fetchRecentReviews(barberId),
    ]);

    const reviewerIds = Array.from(new Set(reviews.map((r) => r.client_id)));
    const reviewerMap = await this.fetchClientsLite(reviewerIds);

    const distanceKm =
      barber.latitude !== null && barber.longitude !== null
        ? haversineKm(
            query.latitude,
            query.longitude,
            Number(barber.latitude),
            Number(barber.longitude),
          )
        : 0;

    const workingHours: BarberWorkingDayDto[] = Array.from({ length: 7 }, (_, day) => {
      const row = schedules.find((s) => s.day_of_week === day);
      return {
        dayOfWeek: day,
        isWorking: row?.is_working ?? false,
        startTime: this.trimTime(row?.regular_start_time ?? null),
        endTime: this.trimTime(row?.regular_end_time ?? null),
      };
    });

    const serviceDtos: BarberDetailServiceDto[] = services.map((s) => ({
      id: s.id,
      name: s.name,
      serviceType: s.service_type as ServiceType,
      regularPrice: Number(s.regular_price_usd),
      durationMinutes: s.duration_minutes,
    }));

    const reviewDtos: BarberDetailReviewDto[] = reviews.map((r) => {
      const reviewer = reviewerMap.get(r.client_id);
      return {
        id: r.id,
        reviewerName: reviewer?.name ?? 'Anonymous',
        reviewerProfileImage: reviewer?.profile_photo_url ?? null,
        rating: r.rating,
        comment: r.comment,
        createdAt: new Date(r.created_at).toISOString(),
      };
    });

    return {
      barber: {
        id: barber.user_id,
        name: barber.full_name,
        profileImage: barber.profile_photo_url,
        bio: barber.bio,
        address: this.buildAddress(barber),
        phone: barber.phone,
        workingHours,
        recurringAvailable: barber.recurring_enabled,
      },
      services: serviceDtos,
      reviews: reviewDtos,
      reviewsSummary: {
        averageRating:
          barber.average_rating !== null ? Number(barber.average_rating) : 0,
        totalReviews: barber.total_reviews ?? 0,
      },
      distance: buildDistance(distanceKm),
    };
  }

  private async resolveServiceSearchBarberIds(search?: string): Promise<string[] | null> {
    if (!search || search.trim().length === 0) return null;

    const { data, error } = await this.db
      .from('barber_services')
      .select('barber_id')
      .ilike('name', `%${search}%`)
      .eq('is_active', true);

    if (error) throw new InternalServerErrorException('Failed to search services');

    return Array.from(new Set((data ?? []).map((r) => r.barber_id as string)));
  }

  private async fetchBarbersFiltered(
    query: ListBarbersQueryDto,
    serviceMatchBarberIds: string[] | null,
  ): Promise<BarberRow[]> {
    let q = this.db
      .from('barbers')
      .select(
        'user_id, full_name, profile_photo_url, bio, phone, street_address, city, state, zip_code, latitude, longitude, average_rating, total_reviews, recurring_enabled, onboarding_complete',
      )
      .eq('onboarding_complete', true);

    if (query.recurring === RecurringFilterDto.AVAILABLE) {
      q = q.eq('recurring_enabled', true);
    } else if (query.recurring === RecurringFilterDto.NOT_AVAILABLE) {
      q = q.eq('recurring_enabled', false);
    }

    if (query.search && query.search.trim().length > 0) {
      const escaped = this.escapeForIlike(query.search);
      const serviceIds = serviceMatchBarberIds ?? [];
      if (serviceIds.length > 0) {
        const ids = serviceIds.join(',');
        q = q.or(`full_name.ilike.%${escaped}%,user_id.in.(${ids})`);
      } else {
        q = q.ilike('full_name', `%${escaped}%`);
      }
    }

    const { data, error } = await q;
    if (error) throw new InternalServerErrorException('Failed to fetch barbers');
    return (data ?? []) as BarberRow[];
  }

  private sortBarbers(
    items: { row: BarberRow; distanceKm: number }[],
    sort: BarberSortDto,
  ): { row: BarberRow; distanceKm: number }[] {
    if (sort === BarberSortDto.TOP_RATED) {
      return [...items].sort((a, b) => {
        const ra = a.row.average_rating !== null ? Number(a.row.average_rating) : 0;
        const rb = b.row.average_rating !== null ? Number(b.row.average_rating) : 0;
        if (rb !== ra) return rb - ra;
        return (b.row.total_reviews ?? 0) - (a.row.total_reviews ?? 0);
      });
    }
    return [...items].sort((a, b) => a.distanceKm - b.distanceKm);
  }

  private async fetchTopServices(
    barberIds: string[],
  ): Promise<Map<string, BarberTopServiceDto[]>> {
    const result = new Map<string, BarberTopServiceDto[]>();
    if (barberIds.length === 0) return result;

    const { data, error } = await this.db
      .from('barber_services')
      .select('barber_id, name, sort_order')
      .in('barber_id', barberIds)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) throw new InternalServerErrorException('Failed to fetch services');

    for (const row of (data ?? []) as Pick<BarberServiceRow, 'barber_id' | 'name' | 'sort_order'>[]) {
      const list = result.get(row.barber_id) ?? [];
      if (list.length < TOP_SERVICES_LIMIT) {
        list.push({ name: row.name });
        result.set(row.barber_id, list);
      }
    }
    return result;
  }

  private async fetchAllServicesForBarber(barberId: string): Promise<BarberServiceRow[]> {
    const { data, error } = await this.db
      .from('barber_services')
      .select('id, barber_id, name, service_type, duration_minutes, regular_price_usd, sort_order')
      .eq('barber_id', barberId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) throw new InternalServerErrorException('Failed to fetch services');
    return (data ?? []) as BarberServiceRow[];
  }

  private async fetchSchedulesForBarber(barberId: string): Promise<ScheduleRow[]> {
    const { data, error } = await this.db
      .from('barber_schedules')
      .select('barber_id, day_of_week, is_working, regular_start_time, regular_end_time')
      .eq('barber_id', barberId);

    if (error) throw new InternalServerErrorException('Failed to fetch schedules');
    return (data ?? []) as ScheduleRow[];
  }

  private async fetchRecentReviews(barberId: string): Promise<ReviewRow[]> {
    const { data, error } = await this.db
      .from('reviews')
      .select('id, client_id, rating, comment, created_at')
      .eq('barber_id', barberId)
      .order('created_at', { ascending: false })
      .limit(REVIEWS_LIMIT);

    if (error) throw new InternalServerErrorException('Failed to fetch reviews');
    return (data ?? []) as ReviewRow[];
  }

  private async fetchClientsLite(clientIds: string[]): Promise<Map<string, ClientLite>> {
    const result = new Map<string, ClientLite>();
    if (clientIds.length === 0) return result;

    const { data, error } = await this.db
      .from('clients')
      .select('user_id, name, profile_photo_url')
      .in('user_id', clientIds);

    if (error) throw new InternalServerErrorException('Failed to fetch reviewers');

    for (const row of data ?? []) {
      result.set(row.user_id as string, {
        user_id: row.user_id as string,
        name: row.name as string,
        profile_photo_url: (row.profile_photo_url as string | null) ?? null,
      });
    }
    return result;
  }

  private buildAddress(b: BarberRow): string | null {
    const parts = [b.street_address, b.city, b.state, b.zip_code].filter(
      (s): s is string => !!s && s.length > 0,
    );
    return parts.length > 0 ? parts.join(', ') : null;
  }

  private trimTime(value: string | null): string | null {
    return value ? value.substring(0, 5) : null;
  }

  private escapeForIlike(value: string): string {
    return value.replace(/[,()]/g, ' ');
  }
}
