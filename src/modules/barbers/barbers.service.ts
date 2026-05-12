import 'multer';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { BookingCompletionService } from '../bookings/booking-completion.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationTypeDto } from '../notifications/dto/notification.dto';
import { BookingTypeDto } from '../bookings/dto/preview-booking.dto';
import {
  projectBookingServices,
  ProjectedBookingService,
} from '../bookings/util/booking-services-projection';
import {
  BARBER_DEFAULT_TIMEZONE,
  projectBookingTime,
} from '../bookings/util/timezone.util';
import { NoShowsService } from '../no-shows/no-shows.service';
import { ConnectService } from '../payments/connect.service';
import { ConnectRequired } from '../payments/payments.exceptions';
import { UpdateBarberProfileDto } from './dto/update-barber-profile.dto';
import { BarberProfileResponseDto } from '../auth/dto/responses/barber-profile.response.dto';
import messages from '../../common/messages.json';
import {
  BookingStatusDto,
  BookingTimeframeDto,
  BookingTypeFilterDto,
  ListBarberBookingsQueryDto,
} from './dto/list-barber-bookings-query.dto';
import {
  BarberBookingListItemDto,
  BarberBookingServiceItemDto,
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
import { InHouseServicesResponseDto } from './dto/update-in-house-services.dto';
import {
  NoShowChargeSettingsResponseDto,
  UpdateNoShowChargeDto,
} from './dto/update-no-show-charge.dto';

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

interface BookingServiceLite {
  booking_id: string;
  barber_service_id: string;
  booking_type: string;
  duration_minutes: number;
  sort_order: number;
}

@Injectable()
export class BarbersService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly completionService: BookingCompletionService,
    private readonly notificationsService: NotificationsService,
    private readonly noShowsService: NoShowsService,
    private readonly connectService: ConnectService
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private async fetchBarberTimezone(barberId: string): Promise<string> {
    const { data, error } = await this.db
      .from('barbers')
      .select('timezone')
      .eq('user_id', barberId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException('Failed to fetch barber timezone');
    return (data?.timezone as string | null | undefined) ?? BARBER_DEFAULT_TIMEZONE;
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

    const servicesByBooking = await this.loadBookingServicesByBookingIds(
      pageRows.map((r) => r.id)
    );

    // Collect every service id referenced (primary FK on bookings + each
    // booking_services row) so we can hydrate names/durations in one query.
    const allServiceIds = new Set<string>();
    for (const r of pageRows) if (r.barber_service_id) allServiceIds.add(r.barber_service_id);
    for (const list of servicesByBooking.values())
      for (const s of list) allServiceIds.add(s.barber_service_id);

    const [{ clientMap, serviceMap }, barberTz] = await Promise.all([
      this.loadRelated(pageRows.map((r) => r.client_id), Array.from(allServiceIds)),
      this.fetchBarberTimezone(barberId),
    ]);

    const bookings: BarberBookingListItemDto[] = pageRows.map((r) => {
      const client = clientMap.get(r.client_id);
      const services = this.buildBarberServiceItems(
        servicesByBooking.get(r.id) ?? [],
        r.barber_service_id,
        serviceMap
      );
      const primary = services[0];
      const totalDurationMinutes = r.duration_minutes ?? 0;
      const time = projectBookingTime(r.scheduled_at, barberTz);
      return {
        id: r.id,
        client: {
          id: r.client_id,
          name: client?.name ?? 'Unknown',
          profilePhotoUrl: client?.profile_photo_url ?? null,
        },
        // Legacy field — populate with primary service NAME but TOTAL block
        // duration so older mobile builds render the correct visual height.
        service: {
          name: primary?.name ?? 'Service',
          durationMinutes: totalDurationMinutes,
        },
        services,
        totalDurationMinutes,
        scheduledAt: time.scheduledAt,
        timezone: time.timezone,
        appointmentDate: time.appointmentDate,
        appointmentTime: time.appointmentTime,
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

    const servicesByBooking = await this.loadBookingServicesByBookingIds([row.id]);
    const bookingServiceRows = servicesByBooking.get(row.id) ?? [];

    const serviceIds = new Set<string>();
    if (row.barber_service_id) serviceIds.add(row.barber_service_id);
    for (const s of bookingServiceRows) serviceIds.add(s.barber_service_id);

    const [{ clientMap, serviceMap }, barberTz] = await Promise.all([
      this.loadRelated([row.client_id], Array.from(serviceIds)),
      this.fetchBarberTimezone(barberId),
    ]);

    const client = clientMap.get(row.client_id);
    const services = this.buildBarberServiceItems(
      bookingServiceRows,
      row.barber_service_id,
      serviceMap
    );
    const primary = services[0];
    const totalDurationMinutes = row.duration_minutes ?? 0;
    const time = projectBookingTime(row.scheduled_at, barberTz);

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
        name: primary?.name ?? 'Service',
        durationMinutes: totalDurationMinutes,
      },
      services,
      totalDurationMinutes,
      scheduledAt: time.scheduledAt,
      timezone: time.timezone,
      appointmentDate: time.appointmentDate,
      appointmentTime: time.appointmentTime,
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
      .select('id, status, confirmed_at, client_id')
      .single();

    if (updateError || !updated) {
      throw new InternalServerErrorException('Failed to confirm booking');
    }

    void this.notificationsService.createAndSendNotification({
      recipientId: updated.client_id as string,
      recipientType: 'client',
      senderId: barberId,
      type: NotificationTypeDto.BOOKING_CONFIRMED,
      bookingId: updated.id as string,
    });

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
      .select('id, status, cancelled_at, cancelled_by, client_id')
      .single();

    if (updateError || !updated) {
      throw new InternalServerErrorException('Failed to cancel booking');
    }

    void this.notificationsService.createAndSendNotification({
      recipientId: updated.client_id as string,
      recipientType: 'client',
      senderId: barberId,
      type: NotificationTypeDto.BOOKING_CANCELLED,
      bookingId: updated.id as string,
    });

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

  public async markNoShow(barberId: string, bookingId: string): Promise<NoShowBookingResponseDto> {
    const existing = await this.fetchBookingForBarber(
      barberId,
      bookingId,
      'id, status, scheduled_at, duration_minutes'
    );
    const status = existing.status as string;
    if (status === 'no_show')
      throw new BadRequestException('Booking is already marked as no-show.');
    if (status === 'pending')
      throw new BadRequestException('Cannot mark a pending booking as no-show.');
    if (status === 'cancelled')
      throw new BadRequestException('Cannot mark a cancelled booking as no-show.');
    if (status !== 'confirmed' && status !== 'completed') {
      throw new BadRequestException(
        'Only confirmed or completed bookings can be marked as no-show.'
      );
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
      .select('id, status, client_id')
      .single();

    if (updateError || !updated) {
      throw new InternalServerErrorException('Failed to mark booking as no-show');
    }

    // Booking transition is final. Record the unresolved no-show row so
    // the client can pay it later — payment is no longer initiated here.
    // Failures of the record step never roll back the no_show status.
    let noShowId: string | null = null;
    let amountUsd: number | null = null;
    try {
      const barberRow = await this.loadBarberNoShowConfig(barberId);
      const amount = Number(barberRow?.no_show_charge_amount_usd ?? 0);
      if (barberRow?.no_show_charge_enabled && amount > 0) {
        const row = await this.noShowsService.recordUnresolved({
          bookingId: updated.id as string,
          barberAuthId: barberId,
          clientAuthId: updated.client_id as string,
          amountUsd: amount,
          reason: null,
        });
        noShowId = row.id;
        amountUsd = row.amountUsd;
      }
    } catch (err) {
      console.error('Failed to record no-show row for booking', updated.id, err);
    }

    return {
      booking: {
        id: updated.id as string,
        status: updated.status as string,
      },
      chargeResult: {
        charged: false,
        amountUsd,
        noShowChargeId: noShowId,
        reason: noShowId ? null : 'disabled',
      },
    };
  }

  private async loadBarberNoShowConfig(
    barberAuthId: string
  ): Promise<{ no_show_charge_enabled: boolean; no_show_charge_amount_usd: number | string | null } | null> {
    const { data } = await this.db
      .from('barbers')
      .select('no_show_charge_enabled, no_show_charge_amount_usd')
      .eq('user_id', barberAuthId)
      .maybeSingle();
    return (data as { no_show_charge_enabled: boolean; no_show_charge_amount_usd: number | string | null } | null) ?? null;
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

  public async updateNoShowChargeSettings(
    barberId: string,
    dto: UpdateNoShowChargeDto
  ): Promise<NoShowChargeSettingsResponseDto> {
    if (dto.enabled) {
      // Connect must already be onboarded with charges_enabled — otherwise
      // PaymentIntents created at no-show time would fail anyway.
      const { data: barber, error: readErr } = await this.db
        .from('barbers')
        .select('stripe_connect_account_id')
        .eq('user_id', barberId)
        .maybeSingle();
      if (readErr) throw new InternalServerErrorException('Failed to fetch barber');
      if (!barber) throw new NotFoundException('Barber profile not found');

      const ok = await this.connectService.hasChargesEnabled(
        barber.stripe_connect_account_id as string | null
      );
      if (!ok) throw new ConnectRequired();
    }

    const patch: Record<string, unknown> = { no_show_charge_enabled: dto.enabled };
    if (dto.amountUsd !== undefined) patch.no_show_charge_amount_usd = dto.amountUsd;

    const { data, error } = await this.db
      .from('barbers')
      .update(patch)
      .eq('user_id', barberId)
      .select('no_show_charge_enabled, no_show_charge_amount_usd')
      .maybeSingle();
    if (error) throw new InternalServerErrorException('Failed to update no-show charge settings');
    if (!data) throw new NotFoundException('Barber profile not found');

    return {
      enabled: data.no_show_charge_enabled as boolean,
      amountUsd:
        data.no_show_charge_amount_usd !== null && data.no_show_charge_amount_usd !== undefined
          ? Number(data.no_show_charge_amount_usd)
          : null,
    };
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

  public async updateInHouseServices(
    barberId: string,
    enabled: boolean
  ): Promise<InHouseServicesResponseDto> {
    const { data, error } = await this.db
      .from('barbers')
      .update({ in_house_services: enabled })
      .eq('user_id', barberId)
      .select('in_house_services')
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to update in-house services flag');
    if (!data) throw new NotFoundException('Barber profile not found');

    return { inHouseServices: data.in_house_services as boolean };
  }

  // ────────────────────────────────────────────────────────────
  // Barber profile — read / update
  // ────────────────────────────────────────────────────────────

  public async getProfile(barberId: string): Promise<BarberProfileResponseDto> {
    const { data, error } = await this.db
      .from('barbers')
      .select('*')
      .eq('user_id', barberId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(messages.barber.PROFILE_LOAD_FAILED);
    if (!data) throw new NotFoundException('Barber profile not found');

    return this.projectCanonicalId(data) as unknown as BarberProfileResponseDto;
  }

  public async updateProfile(
    barberId: string,
    dto: UpdateBarberProfileDto,
    photo?: Express.Multer.File
  ): Promise<BarberProfileResponseDto> {
    const patch: Record<string, unknown> = {};

    if (dto.fullName !== undefined) patch.full_name = dto.fullName;
    if (dto.shopName !== undefined) patch.shop_name = dto.shopName;
    if (dto.phone !== undefined) patch.phone = dto.phone;
    if (dto.streetAddress !== undefined) patch.street_address = dto.streetAddress;
    if (dto.city !== undefined) patch.city = dto.city;
    if (dto.state !== undefined) patch.state = dto.state;
    if (dto.zipCode !== undefined) patch.zip_code = dto.zipCode;
    if (dto.latitude !== undefined) patch.latitude = dto.latitude;
    if (dto.longitude !== undefined) patch.longitude = dto.longitude;
    if (dto.bio !== undefined) patch.bio = dto.bio;
    if (dto.instagramHandle !== undefined) patch.instagram_handle = dto.instagramHandle;

    if (photo) {
      patch.profile_photo_url = await this.uploadProfilePhoto(barberId, photo);
    }

    if (Object.keys(patch).length === 0) {
      return this.getProfile(barberId);
    }

    const { data, error } = await this.db
      .from('barbers')
      .update(patch)
      .eq('user_id', barberId)
      .select('*')
      .maybeSingle();

    if (error) throw new InternalServerErrorException(messages.barber.PROFILE_UPDATE_FAILED);
    if (!data) throw new NotFoundException('Barber profile not found');

    if (dto.fullName !== undefined) {
      await this.supabaseService.getClient().auth.admin.updateUserById(barberId, {
        user_metadata: { full_name: dto.fullName },
      });
    }

    return this.projectCanonicalId(data) as unknown as BarberProfileResponseDto;
  }

  private async uploadProfilePhoto(
    barberId: string,
    photo: Express.Multer.File
  ): Promise<string> {
    const ext = photo.mimetype.split('/')[1] ?? 'jpg';
    const path = `profiles/${barberId}/profile.${ext}`;

    const { error } = await this.db.storage
      .from('images')
      .upload(path, photo.buffer, { contentType: photo.mimetype, upsert: true });

    if (error) throw new InternalServerErrorException(messages.barber.PHOTO_UPLOAD_FAILED);

    const { data } = this.db.storage.from('images').getPublicUrl(path);
    return data.publicUrl;
  }

  // Profile rows still carry both the internal `id` and `user_id`. Expose
  // only the auth id under `id` so every API speaks the same identifier.
  // Settings columns are remapped to their camelCase response field names.
  private projectCanonicalId(row: Record<string, unknown>): Record<string, unknown> {
    const {
      id: _internalId,
      user_id,
      allow_auto_confirm,
      auto_confirm_today,
      recurring_enabled,
      no_show_charge_enabled,
      no_show_charge_amount_usd,
      stripe_connect_account_id,
      latitude,
      longitude,
      ...rest
    } = row;
    return {
      id: user_id,
      ...rest,
      latitude,
      longitude,
      allowAutoConfirm: !!allow_auto_confirm,
      autoConfirmToday: !!auto_confirm_today,
      recurringEnabled: !!recurring_enabled,
      noShowChargeEnabled: !!no_show_charge_enabled,
      noShowChargeAmountUsd:
        no_show_charge_amount_usd !== null && no_show_charge_amount_usd !== undefined
          ? Number(no_show_charge_amount_usd)
          : null,
      stripeConnected: !!stripe_connect_account_id,
      locationSet:
        latitude !== null &&
        latitude !== undefined &&
        longitude !== null &&
        longitude !== undefined,
    };
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

  // Batch-load booking_services rows for N bookings. Caller keys the map
  // by booking_id; each list is sorted by sort_order so startOffsetMinutes
  // is a running sum.
  private async loadBookingServicesByBookingIds(
    bookingIds: string[]
  ): Promise<Map<string, BookingServiceLite[]>> {
    const result = new Map<string, BookingServiceLite[]>();
    if (bookingIds.length === 0) return result;

    const { data, error } = await this.db
      .from('booking_services')
      .select(
        'booking_id, barber_service_id, booking_type, duration_minutes, sort_order'
      )
      .in('booking_id', bookingIds)
      .order('sort_order', { ascending: true });

    if (error) throw new InternalServerErrorException('Failed to fetch booking services');

    for (const row of (data ?? []) as BookingServiceLite[]) {
      const list = result.get(row.booking_id) ?? [];
      list.push(row);
      result.set(row.booking_id, list);
    }
    return result;
  }

  // Project booking_services rows into the API shape. Falls back to the
  // legacy single barber_service_id when no booking_services rows exist
  // (legacy bookings predating the multi-service migration).
  private buildBarberServiceItems(
    rows: BookingServiceLite[],
    legacyServiceId: string | null,
    serviceMap: Map<string, ServiceLite>
  ): BarberBookingServiceItemDto[] {
    const projected: ProjectedBookingService[] = projectBookingServices(
      rows,
      legacyServiceId,
      serviceMap
    );
    return projected;
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
