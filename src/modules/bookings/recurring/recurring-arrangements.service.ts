import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationTypeDto } from '../../notifications/dto/notification.dto';
import {
  ARRANGEMENT_HORIZON_DAYS,
  ArrangementEndType,
  ArrangementFrequency,
  RecurringBookingGeneratorService,
} from './recurring-booking-generator.service';
import {
  ArrangementBarberSummaryDto,
  ArrangementClientSummaryDto,
  ArrangementConflictDto,
  ArrangementServiceSummaryDto,
  RecurringArrangementDto,
  RecurringArrangementResponseDto,
  RecurringArrangementsListResponseDto,
  RecurringArrangementStatus,
} from './dto/recurring-arrangement.dto';
import {
  CreateRecurringArrangementDto,
  RecurringArrangementEndType,
  RecurringArrangementFrequency,
} from './dto/create-recurring-arrangement.dto';
import { ListRecurringArrangementsQueryDto } from './dto/list-recurring-arrangements-query.dto';
import { RejectRecurringArrangementDto } from './dto/reject-recurring-arrangement.dto';
import { localDateInTz, timeToMinutes } from './recurring-time.util';

const PREVIEW_OCCURRENCES = 5;

interface ArrangementRow {
  id: string;
  client_id: string;
  barber_id: string;
  barber_service_id: string;
  day_of_week: number;
  slot_time: string;
  frequency: ArrangementFrequency;
  interval_n: number | null;
  end_type: ArrangementEndType;
  end_count: number | null;
  end_date: string | null;
  note_to_client: string | null;
  declined_reason: string | null;
  initiator: 'client' | 'barber';
  price_usd: string | number;
  duration_minutes: number | null;
  status: RecurringArrangementStatus;
  window_start_date: string | null;
  barber_accepted_at: string | null;
  barber_declined_at: string | null;
  cancelled_at: string | null;
  cancelled_by: 'client' | 'barber' | null;
  created_at: string;
  updated_at: string;
}

interface BarberRow {
  user_id: string;
  full_name: string | null;
  shop_name: string | null;
  profile_photo_url: string | null;
  timezone: string;
}

interface BarberServiceRow {
  id: string;
  barber_id: string;
  name: string;
  service_type: string;
  duration_minutes: number;
  regular_price_usd: number | string;
  recurring_price_usd: number | string | null;
  is_active: boolean;
}

interface ScheduleRow {
  is_working: boolean;
  regular_start_time: string | null;
  regular_end_time: string | null;
  slot_duration_minutes: number;
  day_off_booking_enabled: boolean;
  day_off_start_time: string | null;
  day_off_end_time: string | null;
  recurring_extra_charge_usd: number | string | null;
}

@Injectable()
export class RecurringArrangementsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly generator: RecurringBookingGeneratorService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  // ────────────────────────────────────────────────────────────
  // Barber: create
  // ────────────────────────────────────────────────────────────

  public async createArrangement(
    barberAuthId: string,
    dto: CreateRecurringArrangementDto,
  ): Promise<RecurringArrangementResponseDto> {
    this.validateDtoShape(dto);

    const barber = await this.fetchBarber(barberAuthId);

    await this.assertClientOfBarber(barberAuthId, dto.clientId);

    const requestedIds = dto.services.map((s) => s.barberServiceId);
    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new BadRequestException('Duplicate services are not allowed.');
    }

    const services = await this.fetchServices(barberAuthId, requestedIds);
    if (services.length !== requestedIds.length) {
      throw new NotFoundException('One or more services were not found or inactive for this barber');
    }

    const todayLocal = localDateInTz(new Date(), barber.timezone);
    if (dto.startDate < todayLocal) {
      throw new BadRequestException('startDate must be today or in the future.');
    }

    const schedule = await this.fetchSchedule(barberAuthId, dto.dayOfWeek);
    const window = this.resolveDayWindow(schedule);
    if (!window) {
      throw new BadRequestException('The selected day is not bookable for this barber.');
    }

    const slotStep = schedule.slot_duration_minutes;
    const totalDuration = services.length * slotStep;
    const startMin = timeToMinutes(window.start);
    const endMin = timeToMinutes(window.end);
    const requestedMin = timeToMinutes(dto.timeOfDay);
    if (requestedMin < startMin || requestedMin + totalDuration > endMin) {
      throw new BadRequestException(
        'timeOfDay + service duration falls outside the barber working hours for that day.',
      );
    }
    if ((requestedMin - startMin) % slotStep !== 0) {
      throw new BadRequestException("timeOfDay does not align to the day's slot grid.");
    }

    const extraCharge =
      schedule.recurring_extra_charge_usd !== null && schedule.recurring_extra_charge_usd !== undefined
        ? Number(schedule.recurring_extra_charge_usd)
        : 0;

    const perServicePricing = dto.services.map((selection, idx) => {
      const svc = services.find((s) => s.id === selection.barberServiceId)!;
      const basePrice = Number(svc.recurring_price_usd ?? svc.regular_price_usd);
      const surcharge = idx === 0 ? extraCharge : 0;
      const totalPrice = Number((basePrice + surcharge).toFixed(2));
      return { selection, service: svc, basePrice, surcharge, totalPrice };
    });
    const priceUsd = Number(perServicePricing.reduce((acc, p) => acc + p.totalPrice, 0).toFixed(2));

    // 8-week conflict check before insert.
    const candidates = this.generator.previewOccurrencesUtc(
      {
        dayOfWeek: dto.dayOfWeek,
        timeOfDay: dto.timeOfDay,
        frequency: dto.frequency,
        intervalN: dto.intervalN ?? null,
        startDate: dto.startDate,
        endType: dto.endType,
        endCount: dto.endCount ?? null,
        endDate: dto.endDate ?? null,
        timezone: barber.timezone,
        horizonDays: ARRANGEMENT_HORIZON_DAYS,
      },
      999,
    );

    const conflicts = await this.generator.findCalendarConflicts(
      barberAuthId,
      candidates,
      totalDuration,
      null,
    );
    if (conflicts.length > 0) {
      throw new ConflictException({
        errorCode: 'arrangement_has_conflicts',
        conflicts: conflicts.map<ArrangementConflictDto>((c) => ({
          scheduledAt: c.scheduledAt,
          conflictingBookingId: c.conflictingBookingId,
          reason: c.reason,
        })),
      });
    }

    const primary = services.find((s) => s.id === dto.services[0].barberServiceId)!;
    const normalisedSlotTime = `${dto.timeOfDay}:00`;

    const { data: inserted, error } = await this.db
      .from('recurring_bookings')
      .insert({
        client_id: dto.clientId,
        barber_id: barberAuthId,
        barber_service_id: primary.id,
        day_of_week: dto.dayOfWeek,
        slot_time: normalisedSlotTime,
        frequency: dto.frequency,
        interval_n: dto.frequency === RecurringArrangementFrequency.EVERY_N_WEEKS ? dto.intervalN : null,
        end_type: dto.endType,
        end_count: dto.endType === RecurringArrangementEndType.AFTER_COUNT ? dto.endCount : null,
        end_date: dto.endType === RecurringArrangementEndType.ON_DATE ? dto.endDate : null,
        note_to_client: dto.noteToClient ?? null,
        price_usd: priceUsd,
        duration_minutes: totalDuration,
        status: 'pending_client_approval',
        initiator: 'barber',
        is_renewal: false,
        window_start_date: dto.startDate,
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('This recurring slot is already taken.');
      }
      throw new InternalServerErrorException(`Failed to create arrangement: ${error.message}`);
    }

    const row = inserted as ArrangementRow;

    const childRows = perServicePricing.map((p, idx) => ({
      recurring_booking_id: row.id,
      barber_service_id: p.service.id,
      service_type: p.service.service_type,
      booking_type: p.selection.bookingType,
      duration_minutes: slotStep,
      base_price_usd: p.basePrice,
      slot_type_surcharge_usd: p.surcharge,
      price_usd: p.totalPrice,
      sort_order: idx,
    }));
    const { error: childError } = await this.db
      .from('recurring_booking_services')
      .insert(childRows);

    if (childError) {
      await this.db.from('recurring_bookings').delete().eq('id', row.id);
      throw new InternalServerErrorException('Failed to persist arrangement services');
    }

    void this.notificationsService.createAndSendNotification({
      recipientId: row.client_id,
      recipientType: 'client',
      senderId: barberAuthId,
      type: NotificationTypeDto.RECURRING_ARRANGEMENT_OFFERED,
      recurringBookingId: row.id,
    });

    return { arrangement: await this.buildArrangementDto(row, false) };
  }

  // ────────────────────────────────────────────────────────────
  // Client: accept / reject  (idempotent)
  // ────────────────────────────────────────────────────────────

  public async clientAccept(
    clientAuthId: string,
    arrangementId: string,
  ): Promise<RecurringArrangementResponseDto> {
    const row = await this.fetchForOwner(arrangementId, { clientId: clientAuthId });

    if (row.status === 'active') {
      return { arrangement: await this.buildArrangementDto(row, true) };
    }
    this.assertCanTransition(row, 'active');

    const nowIso = new Date().toISOString();
    const { data: updated, error } = await this.db
      .from('recurring_bookings')
      .update({
        status: 'active',
        barber_accepted_at: nowIso,
      })
      .eq('id', arrangementId)
      .eq('status', 'pending_client_approval')
      .select('*')
      .single();

    if (error || !updated) {
      throw new InternalServerErrorException('Failed to accept arrangement');
    }
    const next = updated as ArrangementRow;

    await this.generator.generate(arrangementId);

    void this.notificationsService.createAndSendNotification({
      recipientId: next.barber_id,
      recipientType: 'barber',
      senderId: clientAuthId,
      type: NotificationTypeDto.RECURRING_ARRANGEMENT_ACCEPTED,
      recurringBookingId: next.id,
    });

    return { arrangement: await this.buildArrangementDto(next, false) };
  }

  public async clientReject(
    clientAuthId: string,
    arrangementId: string,
    dto: RejectRecurringArrangementDto,
  ): Promise<RecurringArrangementResponseDto> {
    const row = await this.fetchForOwner(arrangementId, { clientId: clientAuthId });

    if (row.status === 'rejected') {
      return { arrangement: await this.buildArrangementDto(row, true) };
    }
    this.assertCanTransition(row, 'rejected');

    const nowIso = new Date().toISOString();
    const { data: updated, error } = await this.db
      .from('recurring_bookings')
      .update({
        status: 'rejected',
        barber_declined_at: nowIso,
        declined_reason: dto.reason ?? null,
      })
      .eq('id', arrangementId)
      .eq('status', 'pending_client_approval')
      .select('*')
      .single();

    if (error || !updated) {
      throw new InternalServerErrorException('Failed to reject arrangement');
    }
    const next = updated as ArrangementRow;

    void this.notificationsService.createAndSendNotification({
      recipientId: next.barber_id,
      recipientType: 'barber',
      senderId: clientAuthId,
      type: NotificationTypeDto.RECURRING_ARRANGEMENT_REJECTED,
      recurringBookingId: next.id,
      override: dto.reason ? undefined : undefined,
    });

    return { arrangement: await this.buildArrangementDto(next, false) };
  }

  // ────────────────────────────────────────────────────────────
  // Barber: cancel (pending only) / end (active only)
  // ────────────────────────────────────────────────────────────

  public async barberCancel(
    barberAuthId: string,
    arrangementId: string,
  ): Promise<RecurringArrangementResponseDto> {
    const row = await this.fetchForOwner(arrangementId, { barberId: barberAuthId });
    this.assertCanTransition(row, 'cancelled');

    const nowIso = new Date().toISOString();
    const { data: updated, error } = await this.db
      .from('recurring_bookings')
      .update({
        status: 'cancelled',
        cancelled_at: nowIso,
        cancelled_by: 'barber',
      })
      .eq('id', arrangementId)
      .eq('status', 'pending_client_approval')
      .select('*')
      .single();

    if (error || !updated) {
      throw new InternalServerErrorException('Failed to cancel arrangement');
    }

    return { arrangement: await this.buildArrangementDto(updated as ArrangementRow, false) };
  }

  public async barberEnd(
    barberAuthId: string,
    arrangementId: string,
  ): Promise<RecurringArrangementResponseDto> {
    const row = await this.fetchForOwner(arrangementId, { barberId: barberAuthId });
    this.assertCanTransition(row, 'ended');

    const nowIso = new Date().toISOString();
    const { data: updated, error } = await this.db
      .from('recurring_bookings')
      .update({
        status: 'ended',
        cancelled_at: nowIso,
        cancelled_by: 'barber',
      })
      .eq('id', arrangementId)
      .eq('status', 'active')
      .select('*')
      .single();

    if (error || !updated) {
      throw new InternalServerErrorException('Failed to end arrangement');
    }

    return { arrangement: await this.buildArrangementDto(updated as ArrangementRow, false) };
  }

  // ────────────────────────────────────────────────────────────
  // Reads — list / detail (per-role, 404 on cross-tenant)
  // ────────────────────────────────────────────────────────────

  public async listForBarber(
    barberAuthId: string,
    query: ListRecurringArrangementsQueryDto,
  ): Promise<RecurringArrangementsListResponseDto> {
    return this.list({ barberId: barberAuthId, clientFilter: query.clientId }, query);
  }

  public async listForClient(
    clientAuthId: string,
    query: ListRecurringArrangementsQueryDto,
  ): Promise<RecurringArrangementsListResponseDto> {
    return this.list({ clientId: clientAuthId }, query);
  }

  public async getForBarber(
    barberAuthId: string,
    arrangementId: string,
  ): Promise<RecurringArrangementResponseDto> {
    const row = await this.fetchForOwner(arrangementId, { barberId: barberAuthId });
    return { arrangement: await this.buildArrangementDto(row, false) };
  }

  public async getForClient(
    clientAuthId: string,
    arrangementId: string,
  ): Promise<RecurringArrangementResponseDto> {
    const row = await this.fetchForOwner(arrangementId, { clientId: clientAuthId });
    return { arrangement: await this.buildArrangementDto(row, false) };
  }

  // ────────────────────────────────────────────────────────────
  // State machine
  // ────────────────────────────────────────────────────────────

  private assertCanTransition(
    row: ArrangementRow,
    target: RecurringArrangementStatus,
  ): void {
    const allowed: Record<RecurringArrangementStatus, RecurringArrangementStatus[]> = {
      pending_client_approval: ['active', 'rejected', 'cancelled'],
      active: ['ended'],
      rejected: [],
      cancelled: [],
      ended: [],
    };
    const valid = allowed[row.status] ?? [];
    if (!valid.includes(target)) {
      throw new BadRequestException({
        errorCode: 'invalid_state_transition',
        message: `Cannot transition arrangement from '${row.status}' to '${target}'.`,
        currentState: row.status,
      });
    }
    // Barber-initiated only — protect from a client-initiated row sneaking in.
    if (row.initiator !== 'barber') {
      throw new NotFoundException('Arrangement not found');
    }
  }

  // ────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────

  private validateDtoShape(dto: CreateRecurringArrangementDto): void {
    if (
      dto.frequency === RecurringArrangementFrequency.EVERY_N_WEEKS &&
      (dto.intervalN === undefined || dto.intervalN === null)
    ) {
      throw new BadRequestException('intervalN is required when frequency = every_n_weeks.');
    }
    if (
      dto.frequency !== RecurringArrangementFrequency.EVERY_N_WEEKS &&
      dto.intervalN !== undefined &&
      dto.intervalN !== null
    ) {
      throw new BadRequestException('intervalN may only be set when frequency = every_n_weeks.');
    }
    if (dto.endType === RecurringArrangementEndType.AFTER_COUNT && (dto.endCount ?? 0) < 1) {
      throw new BadRequestException('endCount must be ≥ 1 when endType = after_count.');
    }
    if (dto.endType === RecurringArrangementEndType.ON_DATE) {
      if (!dto.endDate) {
        throw new BadRequestException('endDate is required when endType = on_date.');
      }
      if (dto.endDate <= dto.startDate) {
        throw new BadRequestException('endDate must be after startDate.');
      }
    }
    if (dto.endType === RecurringArrangementEndType.NONE && (dto.endCount || dto.endDate)) {
      throw new BadRequestException(
        'endCount/endDate must not be supplied when endType = none.',
      );
    }
  }

  private async fetchForOwner(
    arrangementId: string,
    owner: { clientId?: string; barberId?: string },
  ): Promise<ArrangementRow> {
    let q = this.db
      .from('recurring_bookings')
      .select('*')
      .eq('id', arrangementId)
      .eq('initiator', 'barber');
    if (owner.clientId) q = q.eq('client_id', owner.clientId);
    if (owner.barberId) q = q.eq('barber_id', owner.barberId);
    const { data, error } = await q.maybeSingle();
    if (error) throw new InternalServerErrorException('Failed to fetch arrangement');
    if (!data) throw new NotFoundException('Arrangement not found');
    return data as ArrangementRow;
  }

  private async list(
    owner: { clientId?: string; barberId?: string; clientFilter?: string },
    query: ListRecurringArrangementsQueryDto,
  ): Promise<RecurringArrangementsListResponseDto> {
    const limit = Math.min(query.limit ?? 20, 50);
    let q = this.db.from('recurring_bookings').select('*').eq('initiator', 'barber');
    if (owner.barberId) q = q.eq('barber_id', owner.barberId);
    if (owner.clientId) q = q.eq('client_id', owner.clientId);
    if (owner.clientFilter) q = q.eq('client_id', owner.clientFilter);
    if (query.status) {
      q = q.eq('status', query.status);
    } else if (owner.clientId) {
      // Client-side default: show pending + active (per spec).
      q = q.in('status', ['pending_client_approval', 'active']);
    }
    if (query.cursor) {
      const cursor = await this.resolveCursor(query.cursor);
      if (cursor) {
        q = q.or(
          `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
        );
      }
    }
    q = q
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const { data, error } = await q;
    if (error) throw new InternalServerErrorException('Failed to list arrangements');

    const rows = (data ?? []) as ArrangementRow[];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const arrangements = await Promise.all(page.map((r) => this.buildArrangementDto(r, false)));
    return {
      arrangements,
      nextCursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
      hasMore,
    };
  }

  private async resolveCursor(
    cursor: string,
  ): Promise<{ id: string; created_at: string } | null> {
    const { data, error } = await this.db
      .from('recurring_bookings')
      .select('id, created_at')
      .eq('id', cursor)
      .maybeSingle();
    if (error) throw new InternalServerErrorException('Failed to resolve cursor');
    if (!data) return null;
    return { id: data.id as string, created_at: data.created_at as string };
  }

  private async assertClientOfBarber(barberId: string, clientId: string): Promise<void> {
    const { count, error } = await this.db
      .from('bookings')
      .select('id', { head: true, count: 'exact' })
      .eq('barber_id', barberId)
      .eq('client_id', clientId)
      .neq('status', 'cancelled');
    if (error) throw new InternalServerErrorException('Failed to verify client relationship');
    if ((count ?? 0) === 0) {
      throw new BadRequestException(
        'clientId is not a current client of this barber (no non-cancelled bookings).',
      );
    }
  }

  private async fetchBarber(barberId: string): Promise<BarberRow> {
    const { data, error } = await this.db
      .from('barbers')
      .select('user_id, full_name, shop_name, profile_photo_url, timezone')
      .eq('user_id', barberId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException('Failed to fetch barber');
    if (!data) throw new NotFoundException('Barber not found');
    return data as BarberRow;
  }

  private async fetchServices(
    barberId: string,
    serviceIds: string[],
  ): Promise<BarberServiceRow[]> {
    const { data, error } = await this.db
      .from('barber_services')
      .select(
        'id, barber_id, name, service_type, duration_minutes, regular_price_usd, recurring_price_usd, is_active',
      )
      .in('id', serviceIds)
      .eq('barber_id', barberId)
      .eq('is_active', true);
    if (error) throw new InternalServerErrorException('Failed to fetch services');
    const byId = new Map<string, BarberServiceRow>();
    for (const row of (data ?? []) as BarberServiceRow[]) byId.set(row.id, row);
    return serviceIds
      .map((id) => byId.get(id))
      .filter((s): s is BarberServiceRow => s !== undefined);
  }

  private async fetchSchedule(barberId: string, dayOfWeek: number): Promise<ScheduleRow> {
    const { data, error } = await this.db
      .from('barber_schedules')
      .select(
        'is_working, regular_start_time, regular_end_time, slot_duration_minutes, day_off_booking_enabled, day_off_start_time, day_off_end_time, recurring_extra_charge_usd',
      )
      .eq('barber_id', barberId)
      .eq('day_of_week', dayOfWeek)
      .maybeSingle();
    if (error) throw new InternalServerErrorException('Failed to fetch schedule');
    if (!data) throw new BadRequestException('Barber has no schedule for that day.');
    return data as ScheduleRow;
  }

  private resolveDayWindow(
    schedule: ScheduleRow,
  ): { start: string; end: string } | null {
    if (schedule.is_working && schedule.regular_start_time && schedule.regular_end_time) {
      return {
        start: schedule.regular_start_time.substring(0, 5),
        end: schedule.regular_end_time.substring(0, 5),
      };
    }
    if (
      schedule.day_off_booking_enabled &&
      schedule.day_off_start_time &&
      schedule.day_off_end_time
    ) {
      return {
        start: schedule.day_off_start_time.substring(0, 5),
        end: schedule.day_off_end_time.substring(0, 5),
      };
    }
    return null;
  }

  private async buildArrangementDto(
    row: ArrangementRow,
    noChange: boolean,
  ): Promise<RecurringArrangementDto> {
    const [barberSummary, clientSummary, services, barber] = await Promise.all([
      this.fetchBarberSummary(row.barber_id),
      this.fetchClientSummary(row.client_id),
      this.fetchArrangementServices(row.id),
      this.fetchBarber(row.barber_id),
    ]);

    const horizonDays =
      row.end_type === 'on_date' || row.end_type === 'after_count'
        ? 365 * 5
        : ARRANGEMENT_HORIZON_DAYS;

    const previewUtc = this.generator.previewOccurrencesUtc(
      {
        dayOfWeek: row.day_of_week,
        timeOfDay: row.slot_time.substring(0, 5),
        frequency: row.frequency,
        intervalN: row.interval_n,
        startDate: row.window_start_date ?? localDateInTz(new Date(), barber.timezone),
        endType: row.end_type,
        endCount: row.end_count,
        endDate: row.end_date,
        timezone: barber.timezone,
        horizonDays,
      },
      PREVIEW_OCCURRENCES,
    );

    return {
      id: row.id,
      status: row.status,
      dayOfWeek: row.day_of_week,
      timeOfDay: row.slot_time.substring(0, 5),
      frequency: row.frequency as RecurringArrangementFrequency,
      intervalN: row.interval_n,
      startDate: row.window_start_date ?? '',
      endType: row.end_type as RecurringArrangementEndType,
      endCount: row.end_count,
      endDate: row.end_date,
      noteToClient: row.note_to_client,
      rejectionReason: row.declined_reason,
      respondedAt: row.barber_accepted_at ?? row.barber_declined_at ?? null,
      priceUsd: Number(row.price_usd),
      totalDurationMinutes: row.duration_minutes ?? 0,
      barber: barberSummary,
      client: clientSummary,
      services,
      nextOccurrences: previewUtc.map((d) => d.toISOString()),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      noChange,
    };
  }

  private async fetchBarberSummary(barberId: string): Promise<ArrangementBarberSummaryDto> {
    const { data } = await this.db
      .from('barbers')
      .select('user_id, full_name, shop_name, profile_photo_url')
      .eq('user_id', barberId)
      .maybeSingle();
    return {
      id: barberId,
      name: (data?.full_name as string | undefined) ?? 'Barber',
      shopName: (data?.shop_name as string | undefined) ?? null,
      avatarUrl: (data?.profile_photo_url as string | undefined) ?? null,
    };
  }

  private async fetchClientSummary(clientId: string): Promise<ArrangementClientSummaryDto> {
    const { data } = await this.db
      .from('clients')
      .select('user_id, name, profile_photo_url')
      .eq('user_id', clientId)
      .maybeSingle();
    return {
      id: clientId,
      name: (data?.name as string | undefined) ?? 'Client',
      avatarUrl: (data?.profile_photo_url as string | undefined) ?? null,
    };
  }

  private async fetchArrangementServices(
    arrangementId: string,
  ): Promise<ArrangementServiceSummaryDto[]> {
    const { data, error } = await this.db
      .from('recurring_booking_services')
      .select(
        'barber_service_id, booking_type, duration_minutes, price_usd, sort_order',
      )
      .eq('recurring_booking_id', arrangementId)
      .order('sort_order', { ascending: true });
    if (error) throw new InternalServerErrorException('Failed to fetch arrangement services');
    const rows = (data ?? []) as Array<{
      barber_service_id: string;
      booking_type: 'regular' | 'after_hours' | 'day_off';
      duration_minutes: number;
      price_usd: number | string;
      sort_order: number;
    }>;
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.barber_service_id);
    const { data: svcs, error: svcErr } = await this.db
      .from('barber_services')
      .select('id, name, duration_minutes')
      .in('id', ids);
    if (svcErr) throw new InternalServerErrorException('Failed to fetch barber services');
    const svcById = new Map<string, { name: string; durationMinutes: number }>();
    for (const s of (svcs ?? []) as Array<{ id: string; name: string; duration_minutes: number }>) {
      svcById.set(s.id, { name: s.name, durationMinutes: s.duration_minutes });
    }

    return rows.map((r) => {
      const meta = svcById.get(r.barber_service_id);
      return {
        id: r.barber_service_id,
        name: meta?.name ?? 'Service',
        durationMinutes: meta?.durationMinutes ?? r.duration_minutes,
        bookingType: r.booking_type,
        priceUsd: Number(r.price_usd),
        sortOrder: r.sort_order,
      };
    });
  }
}
