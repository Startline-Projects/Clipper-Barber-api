import {
  Injectable,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { BookingStatusDto } from '../dto/list-barber-bookings-query.dto';
import { BookingTypeDto } from '../../bookings/dto/preview-booking.dto';
import {
  BarberHomeBookingServiceItemDto,
  BarberHomePendingItemDto,
  BarberHomeResponseDto,
  BarberHomeScheduleItemDto,
} from './dto/barber-home-response.dto';
import {
  BARBER_DEFAULT_TIMEZONE,
  isValidTimezone,
  localDateInTz,
  projectBookingTime,
} from '../../bookings/util/timezone.util';
import {
  BarberCategoryTag,
  normalizeCategories,
} from '../../../common/enums/barber-category-tag.enum';

interface RpcClient {
  id: string;
  fullName: string;
  profilePhotoUrl: string | null;
}

interface RpcService {
  id: string;
  name: string;
  durationMinutes?: number;
}

interface RpcBookingServiceItem {
  id: string;
  name: string;
  durationMinutes: number | string;
  bookingType: string;
}

interface RpcPendingItem {
  bookingId: string;
  client: RpcClient;
  service: RpcService | null;
  services?: RpcBookingServiceItem[] | null;
  scheduledAt: string;
  priceUsd: number | string;
  status: string;
  requestedAt: string;
}

interface RpcScheduleItem {
  bookingId: string;
  client: RpcClient;
  service: (RpcService & { durationMinutes: number }) | null;
  services?: RpcBookingServiceItem[] | null;
  totalDurationMinutes?: number | string | null;
  scheduledAt: string;
  endAt: string;
  minutesUntilStart: number;
  priceUsd: number | string;
  status: string;
}

interface RpcResult {
  today: {
    date: string;
    timezone: string;
    totalAppointments: number;
    completedCount: number;
    remainingCount: number;
    earningsSoFarUsd: number | string;
  };
  pendingApproval: {
    totalCount: number;
    items: RpcPendingItem[];
  };
  schedule: {
    totalUpcomingToday: number;
    items: RpcScheduleItem[];
  };
}

@Injectable()
export class BarberHomeService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  public async getHome(barberId: string, tzOverride?: string): Promise<BarberHomeResponseDto> {
    const settings = await this.loadBarberSettings(barberId);
    const tz = this.resolveTimezone(settings.timezone, tzOverride);
    const nowIso = new Date().toISOString();

    const { data, error } = await this.db.rpc('get_barber_home', {
      p_barber_id: barberId,
      p_tz: tz,
      p_now: nowIso,
    });

    if (error) throw new InternalServerErrorException('Failed to load home dashboard');

    const result = data as RpcResult | null;
    if (!result) {
      // Empty-state shape — never null lists.
      return {
        today: {
          date: localDateInTz(new Date(), tz),
          timezone: tz,
          totalAppointments: 0,
          completedCount: 0,
          remainingCount: 0,
          earningsSoFarUsd: 0,
        },
        pendingApproval: { totalCount: 0, items: [] },
        schedule: { totalUpcomingToday: 0, items: [] },
        allowAutoConfirm: settings.allowAutoConfirm,
        autoConfirmToday: settings.autoConfirmToday,
        recurringEnabled: settings.recurringEnabled,
        noShowChargeEnabled: settings.noShowChargeEnabled,
        noShowChargeAmountUsd: settings.noShowChargeAmountUsd,
        stripeConnected: settings.stripeConnected,
        locationSet: settings.locationSet,
        categories: settings.categories,
      };
    }

    return {
      today: {
        date: result.today.date,
        timezone: result.today.timezone,
        totalAppointments: Number(result.today.totalAppointments ?? 0),
        completedCount: Number(result.today.completedCount ?? 0),
        remainingCount: Number(result.today.remainingCount ?? 0),
        earningsSoFarUsd: Number(result.today.earningsSoFarUsd ?? 0),
      },
      pendingApproval: {
        totalCount: Number(result.pendingApproval.totalCount ?? 0),
        items: (result.pendingApproval.items ?? []).map((it) =>
          BarberHomeService.shapePendingItem(it, tz)
        ),
      },
      schedule: {
        totalUpcomingToday: Number(result.schedule.totalUpcomingToday ?? 0),
        items: (result.schedule.items ?? []).map((it) =>
          BarberHomeService.shapeScheduleItem(it, tz)
        ),
      },
      allowAutoConfirm: settings.allowAutoConfirm,
      autoConfirmToday: settings.autoConfirmToday,
      recurringEnabled: settings.recurringEnabled,
      noShowChargeEnabled: settings.noShowChargeEnabled,
      noShowChargeAmountUsd: settings.noShowChargeAmountUsd,
      stripeConnected: settings.stripeConnected,
      locationSet: settings.locationSet,
      categories: settings.categories,
    };
  }

  private static shapePendingItem(item: RpcPendingItem, tz: string): BarberHomePendingItemDto {
    const time = projectBookingTime(item.scheduledAt, tz);
    return {
      bookingId: item.bookingId,
      client: {
        id: item.client.id,
        fullName: item.client.fullName,
        profilePhotoUrl: item.client.profilePhotoUrl,
      },
      service: item.service ? { id: item.service.id, name: item.service.name } : null,
      services: BarberHomeService.shapeBookingServices(item.services),
      scheduledAt: time.scheduledAt,
      timezone: time.timezone,
      appointmentDate: time.appointmentDate,
      appointmentTime: time.appointmentTime,
      priceUsd: Number(item.priceUsd ?? 0),
      status: item.status as BookingStatusDto,
      requestedAt: new Date(item.requestedAt).toISOString(),
    };
  }

  private static shapeScheduleItem(item: RpcScheduleItem, tz: string): BarberHomeScheduleItemDto {
    const totalDurationMinutes = Number(item.totalDurationMinutes ?? 0);
    const time = projectBookingTime(item.scheduledAt, tz);
    return {
      bookingId: item.bookingId,
      client: {
        id: item.client.id,
        fullName: item.client.fullName,
        profilePhotoUrl: item.client.profilePhotoUrl,
      },
      service: item.service
        ? {
            id: item.service.id,
            name: item.service.name,
            // RPC now emits TOTAL block duration here for the legacy field.
            durationMinutes: Number(item.service.durationMinutes ?? 0),
          }
        : null,
      services: BarberHomeService.shapeBookingServices(item.services),
      totalDurationMinutes,
      scheduledAt: time.scheduledAt,
      timezone: time.timezone,
      appointmentDate: time.appointmentDate,
      appointmentTime: time.appointmentTime,
      endAt: new Date(item.endAt).toISOString(),
      minutesUntilStart: Number(item.minutesUntilStart ?? 0),
      priceUsd: Number(item.priceUsd ?? 0),
      status: item.status as BookingStatusDto,
    };
  }

  private static shapeBookingServices(
    rows: RpcBookingServiceItem[] | null | undefined
  ): BarberHomeBookingServiceItemDto[] {
    if (!rows || rows.length === 0) return [];
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      durationMinutes: Number(s.durationMinutes ?? 0),
      bookingType: s.bookingType as BookingTypeDto,
    }));
  }

  // ────────────────────────────────────────────────────────────
  // Timezone resolution
  // tz query param > barbers.timezone > 'UTC'.
  // Validated via Intl.DateTimeFormat — same approach as
  // recurring-time.util.ts. Invalid tz → 422.
  // ────────────────────────────────────────────────────────────

  private resolveTimezone(stored: string | null, override?: string): string {
    if (override !== undefined) {
      if (!isValidTimezone(override)) {
        throw new UnprocessableEntityException(`Invalid IANA timezone: ${override}`);
      }
      return override;
    }
    if (stored && isValidTimezone(stored)) return stored;
    return BARBER_DEFAULT_TIMEZONE;
  }

  private async loadBarberSettings(barberId: string): Promise<{
    timezone: string | null;
    allowAutoConfirm: boolean;
    autoConfirmToday: boolean;
    recurringEnabled: boolean;
    noShowChargeEnabled: boolean;
    noShowChargeAmountUsd: number | null;
    stripeConnected: boolean;
    locationSet: boolean;
    categories: BarberCategoryTag[];
  }> {
    const { data, error } = await this.db
      .from('barbers')
      .select(
        'timezone, allow_auto_confirm, auto_confirm_today, recurring_enabled, no_show_charge_enabled, no_show_charge_amount_usd, stripe_connect_account_id, latitude, longitude, categories'
      )
      .eq('user_id', barberId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to load barber settings');

    return {
      timezone: (data?.timezone as string | null | undefined) ?? null,
      allowAutoConfirm: !!data?.allow_auto_confirm,
      autoConfirmToday: !!data?.auto_confirm_today,
      recurringEnabled: !!data?.recurring_enabled,
      noShowChargeEnabled: !!data?.no_show_charge_enabled,
      noShowChargeAmountUsd:
        data?.no_show_charge_amount_usd !== null && data?.no_show_charge_amount_usd !== undefined
          ? Number(data.no_show_charge_amount_usd)
          : null,
      stripeConnected: !!data?.stripe_connect_account_id,
      locationSet:
        data?.latitude !== null &&
        data?.latitude !== undefined &&
        data?.longitude !== null &&
        data?.longitude !== undefined,
      categories: normalizeCategories(data?.categories as string[] | null | undefined),
    };
  }
}
