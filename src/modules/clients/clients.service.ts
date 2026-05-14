import 'multer';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Inject, forwardRef } from '@nestjs/common';
import { SupabaseService, SupabaseUserPayload } from '../supabase/supabase.service';
import { NoShowsService } from '../no-shows/no-shows.service';
import { splitLocalDateTime } from '../bookings/util/timezone.util';
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
import { ClientNextBookingDto, ClientProfileResponseDto } from './dto/client-profile-response.dto';
import { UpdateClientProfileDto } from './dto/update-client-profile.dto';
import { BookingStatusDto } from '../barbers/dto/list-barber-bookings-query.dto';
import { ServiceType } from '../barbers/services/dto/create-barber-service.dto';
import { buildDistance, haversineKm } from './utils/distance.util';
import { normalizeCategories } from '../../common/enums/barber-category-tag.enum';
import messages from '../../common/messages.json';

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
  categories: string[] | null;
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

interface ClientRow {
  user_id: string;
  name: string;
  username: string | null;
  profile_photo_url: string | null;
  subscription_status: string;
  subscription_expires_at: string | null;
  created_at: string;
}

interface UpcomingBookingRow {
  id: string;
  scheduled_at: string;
  status: string;
  duration_minutes: number | null;
  barber_id: string;
  barber_service_id: string | null;
  recurring_booking_id: string | null;
}

interface BarberLiteForBooking {
  user_id: string;
  full_name: string;
  profile_photo_url: string | null;
  timezone: string;
}

interface ServiceLiteForBooking {
  id: string;
  name: string;
  duration_minutes: number;
}

@Injectable()
export class ClientsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    @Inject(forwardRef(() => NoShowsService))
    private readonly noShowsService: NoShowsService
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  public async listBarbersForClient(query: ListBarbersQueryDto): Promise<ListBarbersResponseDto> {
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
      categories: normalizeCategories(row.categories),
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
    callerClientAuthId: string,
    barberId: string,
    query: GetBarberDetailQueryDto
  ): Promise<BarberDetailResponseDto> {
    const { data: barberData, error: barberError } = await this.db
      .from('barbers')
      .select(
        'user_id, full_name, profile_photo_url, bio, phone, street_address, city, state, zip_code, latitude, longitude, average_rating, total_reviews, recurring_enabled, categories, onboarding_complete'
      )
      .eq('user_id', barberId)
      .eq('onboarding_complete', true)
      .maybeSingle();

    if (barberError) throw new InternalServerErrorException('Failed to fetch barber');
    if (!barberData) throw new NotFoundException('Barber not found');

    const barber = barberData as BarberRow;

    const [services, schedules, reviews, hasActivePlan, unresolvedNoShowsCount] = await Promise.all(
      [
        this.fetchAllServicesForBarber(barberId),
        this.fetchSchedulesForBarber(barberId),
        this.fetchRecentReviews(barberId),
        this.hasClientActivePlan(callerClientAuthId),
        this.noShowsService.unresolvedCount(callerClientAuthId),
      ]
    );

    const reviewerIds = Array.from(new Set(reviews.map((r) => r.client_id)));
    const reviewerMap = await this.fetchClientsLite(reviewerIds);

    const distanceKm =
      barber.latitude !== null && barber.longitude !== null
        ? haversineKm(
            query.latitude,
            query.longitude,
            Number(barber.latitude),
            Number(barber.longitude)
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
        categories: normalizeCategories(barber.categories),
      },
      services: serviceDtos,
      reviews: reviewDtos,
      reviewsSummary: {
        averageRating: barber.average_rating !== null ? Number(barber.average_rating) : 0,
        totalReviews: barber.total_reviews ?? 0,
      },
      distance: buildDistance(distanceKm),
      hasActivePlan,
      unresolvedNoShowsCount,
      hasBlockedNoShows: unresolvedNoShowsCount >= 3,
    };
  }

  // Whether the caller's clients.subscription_status is 'active'. Surfaces a
  // single boolean to gate subscription-only flows on the client UI.
  public async hasClientActivePlan(clientAuthId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from('clients')
      .select('subscription_status')
      .eq('user_id', clientAuthId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to load subscription status');
    if (!data) return false;
    return (data.subscription_status as string | null) === 'active';
  }

  // ────────────────────────────────────────────────────────────
  // Client profile — read / update
  // ────────────────────────────────────────────────────────────

  public async getProfile(user: SupabaseUserPayload): Promise<ClientProfileResponseDto> {
    const row = await this.fetchClientRow(user.sub);
    const nextUpcomingBooking = await this.fetchFirstUpcomingBookingForClient(user.sub);
    return this.buildClientProfileResponse(row, user.email ?? null, nextUpcomingBooking);
  }

  public async updateProfile(
    user: SupabaseUserPayload,
    dto: UpdateClientProfileDto,
    photo?: Express.Multer.File
  ): Promise<ClientProfileResponseDto> {
    if (dto.username !== undefined) {
      const { data: existing, error: existingError } = await this.db
        .from('clients')
        .select('user_id')
        .eq('username', dto.username)
        .maybeSingle();

      if (existingError) {
        throw new InternalServerErrorException(messages.client.PROFILE_UPDATE_FAILED);
      }
      if (existing && existing.user_id !== user.sub) {
        throw new ConflictException(messages.client.USERNAME_TAKEN);
      }
    }

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.username !== undefined) patch.username = dto.username;

    if (photo) {
      patch.profile_photo_url = await this.uploadClientPhoto(user.sub, photo);
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await this.db
        .from('clients')
        .update(patch)
        .eq('user_id', user.sub)
        .select('user_id')
        .maybeSingle();

      if (error) {
        throw new InternalServerErrorException(messages.client.PROFILE_UPDATE_FAILED);
      }
    }

    if (dto.username !== undefined) {
      await this.supabaseService.getClient().auth.admin.updateUserById(user.sub, {
        user_metadata: { username: dto.username },
      });
    }

    const row = await this.fetchClientRow(user.sub);
    const nextUpcomingBooking = await this.fetchFirstUpcomingBookingForClient(user.sub);
    return this.buildClientProfileResponse(row, user.email ?? null, nextUpcomingBooking);
  }

  private async fetchClientRow(clientAuthId: string): Promise<ClientRow> {
    const { data, error } = await this.db
      .from('clients')
      .select(
        'user_id, name, username, profile_photo_url, subscription_status, subscription_expires_at, created_at'
      )
      .eq('user_id', clientAuthId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(messages.client.PROFILE_LOAD_FAILED);
    if (!data) throw new NotFoundException(messages.client.PROFILE_NOT_FOUND);
    return data as ClientRow;
  }

  private async uploadClientPhoto(
    clientAuthId: string,
    photo: Express.Multer.File
  ): Promise<string> {
    const ext = photo.mimetype.split('/')[1] ?? 'jpg';
    const path = `profiles/${clientAuthId}/profile.${ext}`;

    const { error } = await this.db.storage
      .from('images')
      .upload(path, photo.buffer, { contentType: photo.mimetype, upsert: true });

    if (error) throw new InternalServerErrorException(messages.client.PROFILE_UPDATE_FAILED);

    const { data } = this.db.storage.from('images').getPublicUrl(path);
    return data.publicUrl;
  }

  private buildClientProfileResponse(
    row: ClientRow,
    email: string | null,
    nextUpcomingBooking: ClientNextBookingDto | null
  ): ClientProfileResponseDto {
    return {
      id: row.user_id,
      name: row.name,
      username: row.username ?? null,
      profilePhotoUrl: row.profile_photo_url ?? null,
      email,
      subscriptionStatus: row.subscription_status,
      subscriptionExpiresAt: row.subscription_expires_at ?? null,
      createdAt: new Date(row.created_at).toISOString(),
      nextUpcomingBooking,
    };
  }

  private async fetchFirstUpcomingBookingForClient(
    clientAuthId: string
  ): Promise<ClientNextBookingDto | null> {
    const nowIso = new Date().toISOString();

    const { data, error } = await this.db
      .from('bookings')
      .select(
        'id, scheduled_at, status, duration_minutes, barber_id, barber_service_id, recurring_booking_id'
      )
      .eq('client_id', clientAuthId)
      .in('status', ['pending', 'confirmed'])
      .gte('scheduled_at', nowIso)
      .order('scheduled_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to fetch upcoming booking');
    if (!data) return null;

    const row = data as UpcomingBookingRow;

    const [barber, service] = await Promise.all([
      this.fetchBarberLite(row.barber_id),
      row.barber_service_id ? this.fetchServiceLite(row.barber_service_id) : Promise.resolve(null),
    ]);

    const timezone = barber?.timezone ?? 'UTC';
    const local = splitLocalDateTime(row.scheduled_at, timezone);

    return {
      id: row.id,
      barberId: row.barber_id,
      barberName: barber?.full_name ?? 'Unknown',
      barberProfileImage: barber?.profile_photo_url ?? null,
      serviceName: service?.name ?? 'Service',
      scheduledAt: new Date(row.scheduled_at).toISOString(),
      appointmentDate: local.date,
      appointmentTime: local.time,
      durationMinutes: row.duration_minutes ?? service?.duration_minutes ?? 0,
      status: row.status as BookingStatusDto,
      isRecurring: row.recurring_booking_id !== null,
      recurringBookingId: row.recurring_booking_id,
    };
  }

  private async fetchBarberLite(barberAuthId: string): Promise<BarberLiteForBooking | null> {
    const { data, error } = await this.db
      .from('barbers')
      .select('user_id, full_name, profile_photo_url, timezone')
      .eq('user_id', barberAuthId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to fetch barber');
    if (!data) return null;
    return {
      user_id: data.user_id as string,
      full_name: data.full_name as string,
      profile_photo_url: (data.profile_photo_url as string | null) ?? null,
      timezone: (data.timezone as string | null) ?? 'UTC',
    };
  }

  private async fetchServiceLite(serviceId: string): Promise<ServiceLiteForBooking | null> {
    const { data, error } = await this.db
      .from('barber_services')
      .select('id, name, duration_minutes')
      .eq('id', serviceId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to fetch service');
    if (!data) return null;
    return {
      id: data.id as string,
      name: data.name as string,
      duration_minutes: data.duration_minutes as number,
    };
  }

  // ────────────────────────────────────────────────────────────
  // Barber browsing helpers
  // ────────────────────────────────────────────────────────────

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
    serviceMatchBarberIds: string[] | null
  ): Promise<BarberRow[]> {
    let q = this.db
      .from('barbers')
      .select(
        'user_id, full_name, profile_photo_url, bio, phone, street_address, city, state, zip_code, latitude, longitude, average_rating, total_reviews, recurring_enabled, categories, onboarding_complete'
      )
      .eq('onboarding_complete', true);

    if (query.recurring === RecurringFilterDto.AVAILABLE) {
      q = q.eq('recurring_enabled', true);
    } else if (query.recurring === RecurringFilterDto.NOT_AVAILABLE) {
      q = q.eq('recurring_enabled', false);
    }

    // Category filter — match barbers having ANY of the selected tags.
    // `overlaps` maps to the `&&` array operator, backed by the
    // barbers_categories_gin index.
    if (query.categories && query.categories.length > 0) {
      q = q.overlaps('categories', query.categories);
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
    sort: BarberSortDto
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

  private async fetchTopServices(barberIds: string[]): Promise<Map<string, BarberTopServiceDto[]>> {
    const result = new Map<string, BarberTopServiceDto[]>();
    if (barberIds.length === 0) return result;

    const { data, error } = await this.db
      .from('barber_services')
      .select('barber_id, name, sort_order')
      .in('barber_id', barberIds)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) throw new InternalServerErrorException('Failed to fetch services');

    for (const row of (data ?? []) as Pick<
      BarberServiceRow,
      'barber_id' | 'name' | 'sort_order'
    >[]) {
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
      (s): s is string => !!s && s.length > 0
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
