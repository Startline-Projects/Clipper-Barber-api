import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { formatDistanceToNow } from 'date-fns';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { CreateReviewResponseDto } from './dto/create-review-response.dto';
import { ListReviewsQueryDto } from './dto/list-reviews-query.dto';
import {
  ReviewListItemDto,
  ReviewsListResponseDto,
} from './dto/reviews-list-response.dto';
import {
  RatingBreakdownEntryDto,
  ReviewsAnalyticsResponseDto,
} from './dto/reviews-analytics-response.dto';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

interface ReviewRow {
  id: string;
  client_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

interface BarberSummaryRow {
  user_id: string;
  full_name: string;
}

interface ClientSummaryRow {
  user_id: string;
  name: string;
  profile_photo_url: string | null;
}

@Injectable()
export class ReviewsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  // ────────────────────────────────────────────────────────────
  // Create
  // ────────────────────────────────────────────────────────────

  public async createReview(
    clientId: string,
    bookingId: string,
    dto: CreateReviewDto
  ): Promise<CreateReviewResponseDto> {
    const { data: booking, error: bookingError } = await this.db
      .from('bookings')
      .select('id, barber_id, client_id, status')
      .eq('id', bookingId)
      .maybeSingle();

    if (bookingError) throw new InternalServerErrorException('Failed to fetch booking');
    if (!booking || (booking.client_id as string) !== clientId) {
      throw new NotFoundException('Booking not found');
    }

    if ((booking.status as string) !== 'completed') {
      throw new BadRequestException('You can only review completed bookings.');
    }

    const { data: inserted, error: insertError } = await this.db
      .from('reviews')
      .insert({
        booking_id: bookingId,
        client_id: clientId,
        barber_id: booking.barber_id as string,
        rating: dto.rating,
        comment: dto.comment ?? null,
      })
      .select('id, booking_id, rating, comment, created_at')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        throw new ConflictException('You have already reviewed this booking.');
      }
      throw new InternalServerErrorException('Failed to create review');
    }

    return {
      review: {
        id: inserted.id as string,
        bookingId: inserted.booking_id as string,
        rating: inserted.rating as number,
        comment: (inserted.comment as string | null) ?? null,
        createdAt: new Date(inserted.created_at as string).toISOString(),
      },
    };
  }

  // ────────────────────────────────────────────────────────────
  // List (shared between client → barber and barber → self)
  // ────────────────────────────────────────────────────────────

  public async listReviewsForBarber(
    barberId: string,
    query: ListReviewsQueryDto
  ): Promise<ReviewsListResponseDto> {
    const barber = await this.fetchBarberSummary(barberId);
    if (!barber) throw new NotFoundException('Barber not found');

    const limit = Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const cursorRow = await this.resolveReviewCursor(barberId, query.cursor);

    const { averageRating, totalReviews } = await this.computeAggregates(barberId);

    let q = this.db
      .from('reviews')
      .select('id, client_id, rating, comment, created_at')
      .eq('barber_id', barberId);

    if (query.rating !== undefined) {
      q = q.eq('rating', query.rating);
    }

    if (cursorRow) {
      q = q.or(
        `created_at.lt.${cursorRow.created_at},and(created_at.eq.${cursorRow.created_at},id.lt.${cursorRow.id})`
      );
    }

    q = q
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const { data, error } = await q;
    if (error) throw new InternalServerErrorException('Failed to fetch reviews');

    const rows = (data ?? []) as ReviewRow[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const clientMap = await this.loadClients(pageRows.map((r) => r.client_id));

    const reviews: ReviewListItemDto[] = pageRows.map((r) => {
      const client = clientMap.get(r.client_id);
      const createdAt = new Date(r.created_at);
      return {
        id: r.id,
        client: {
          name: client?.name ?? 'Unknown',
          profilePhotoUrl: client?.profile_photo_url ?? null,
        },
        rating: r.rating,
        comment: r.comment ?? null,
        relativeTime: formatDistanceToNow(createdAt, { addSuffix: true }),
        createdAt: createdAt.toISOString(),
      };
    });

    return {
      barber: {
        id: barber.user_id,
        name: barber.full_name,
        averageRating,
        totalReviews,
      },
      reviews,
      nextCursor: hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
      hasMore,
    };
  }

  // ────────────────────────────────────────────────────────────
  // Analytics — total + average + per-star breakdown
  // ────────────────────────────────────────────────────────────

  public async getAnalyticsForBarber(barberId: string): Promise<ReviewsAnalyticsResponseDto> {
    const barber = await this.fetchBarberSummary(barberId);
    if (!barber) throw new NotFoundException('Barber not found');

    const { data, error } = await this.db
      .from('reviews')
      .select('rating')
      .eq('barber_id', barberId);

    if (error) throw new InternalServerErrorException('Failed to fetch reviews analytics');

    const ratings = (data ?? []) as Array<{ rating: number }>;
    const totalReviews = ratings.length;

    const counts = new Map<number, number>([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0]]);
    let sum = 0;
    for (const row of ratings) {
      const r = Number(row.rating);
      if (counts.has(r)) counts.set(r, (counts.get(r) ?? 0) + 1);
      sum += r;
    }

    const averageRating = totalReviews === 0 ? null : Math.round((sum / totalReviews) * 10) / 10;

    const ratingsBreakdown: RatingBreakdownEntryDto[] = [5, 4, 3, 2, 1].map((rating) => {
      const count = counts.get(rating) ?? 0;
      const percentage = totalReviews === 0 ? 0 : Math.round((count / totalReviews) * 100);
      return { rating, count, percentage };
    });

    return { totalReviews, averageRating, ratingsBreakdown };
  }

  // ────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────

  private async fetchBarberSummary(barberId: string): Promise<BarberSummaryRow | null> {
    const { data, error } = await this.db
      .from('barbers')
      .select('user_id, full_name')
      .eq('user_id', barberId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to fetch barber');
    if (!data) return null;
    return {
      user_id: data.user_id as string,
      full_name: data.full_name as string,
    };
  }

  private async computeAggregates(
    barberId: string
  ): Promise<{ averageRating: number | null; totalReviews: number }> {
    const { data, error, count } = await this.db
      .from('reviews')
      .select('rating', { count: 'exact' })
      .eq('barber_id', barberId);

    if (error) throw new InternalServerErrorException('Failed to compute review aggregates');

    const total = count ?? 0;
    if (total === 0) return { averageRating: null, totalReviews: 0 };

    const ratings = (data ?? []) as Array<{ rating: number }>;
    const sum = ratings.reduce((acc, row) => acc + Number(row.rating), 0);
    const avg = Math.round((sum / ratings.length) * 10) / 10;

    return { averageRating: avg, totalReviews: total };
  }

  private async resolveReviewCursor(
    barberId: string,
    cursor?: string
  ): Promise<{ id: string; created_at: string } | null> {
    if (!cursor) return null;
    const { data, error } = await this.db
      .from('reviews')
      .select('id, created_at')
      .eq('id', cursor)
      .eq('barber_id', barberId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to resolve cursor');
    if (!data) return null;
    return { id: data.id as string, created_at: data.created_at as string };
  }

  private async loadClients(clientIds: string[]): Promise<Map<string, ClientSummaryRow>> {
    const map = new Map<string, ClientSummaryRow>();
    const unique = Array.from(new Set(clientIds));
    if (unique.length === 0) return map;

    const { data, error } = await this.db
      .from('clients')
      .select('user_id, name, profile_photo_url')
      .in('user_id', unique);

    if (error) throw new InternalServerErrorException('Failed to fetch clients');
    for (const c of data ?? []) {
      map.set(c.user_id as string, {
        user_id: c.user_id as string,
        name: c.name as string,
        profile_photo_url: (c.profile_photo_url as string | null) ?? null,
      });
    }
    return map;
  }
}
