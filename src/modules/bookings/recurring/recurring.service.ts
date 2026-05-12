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
import { RecurringBookingGeneratorService } from './recurring-booking-generator.service';
import {
  RecurringSlotDto,
  RecurringSlotsResponseDto,
} from './dto/recurring-slots-response.dto';
import {
  CreateRecurringBookingDto,
  RecurringBookingFrequency,
} from './dto/create-recurring-booking.dto';
import { DeclineRecurringBookingDto } from './dto/decline-recurring-booking.dto';
import { PauseRecurringBookingDto } from './dto/pause-recurring-booking.dto';
import {
  RecurringBookingDto,
  RecurringBookingResponseDto,
  RecurringBookingServiceDto,
  RecurringBookingStatus,
} from './dto/recurring-booking.dto';
import { BookingTypeDto } from '../dto/preview-booking.dto';
import { CreateBarberRecurringBookingDto } from './dto/create-barber-recurring-booking.dto';
import {
  RecurringBookingDetailResponseDto,
  RecurringOccurrenceDto,
} from './dto/recurring-booking-detail.dto';
import { ListRecurringBookingsQueryDto } from './dto/list-recurring-bookings-query.dto';
import {
  RecurringBookingListItemDto,
  RecurringBookingsListResponseDto,
} from './dto/recurring-booking-list.dto';
import { ClientBookingsPageQueryDto } from '../dto/client-bookings-page-query.dto';
import {
  ClientRecurringBookingListItemDto,
  ClientRecurringBookingsListResponseDto,
  ClientRecurringStatusDto,
} from './dto/client-recurring-booking-list.dto';
import { BookingStatusDto } from '../../barbers/dto/list-barber-bookings-query.dto';
import {
  MINUTE_MS,
  composeUtcFromLocal,
  localDateInTz,
  minutesToTime,
  nextMatchingDates,
  splitLocalDateTime,
  timeToMinutes,
} from './recurring-time.util';

const RECURRING_WINDOW_DAYS = 60;

type RecurringFrequency = 'weekly' | 'biweekly';
type RecurringFrequencyOption = RecurringFrequency | 'both';

interface BarberRow {
  user_id: string;
  timezone: string;
  recurring_enabled: boolean;
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

interface RecurringBookingServiceSnapshot {
  barber_service_id: string;
  service_type: string;
  booking_type: string;
  duration_minutes: number;
  base_price_usd: string | number;
  slot_type_surcharge_usd: string | number;
  price_usd: string | number;
  sort_order: number;
}

interface ScheduleRow {
  barber_id: string;
  day_of_week: number;
  is_working: boolean;
  regular_start_time: string | null;
  regular_end_time: string | null;
  slot_duration_minutes: number;
  day_off_booking_enabled: boolean;
  day_off_start_time: string | null;
  day_off_end_time: string | null;
  recurring_enabled: boolean;
  recurring_frequency: RecurringFrequencyOption | null;
  recurring_extra_charge_usd: number | string | null;
}

@Injectable()
export class RecurringBookingsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly generator: RecurringBookingGeneratorService,
    private readonly notificationsService: NotificationsService,
  ) {}

  protected get db() {
    return this.supabaseService.getClient();
  }

  public async getRecurringSlots(
    barberId: string,
    serviceIds: string[],
    dayOfWeek: number,
  ): Promise<RecurringSlotsResponseDto> {
    const unavailable: RecurringSlotsResponseDto = {
      dayOfWeek,
      recurringAvailable: false,
      recurringFrequencyOptions: [],
      recurringPriceUsd: null,
      totalDurationMinutes: 0,
      slots: [],
    };

    if (new Set(serviceIds).size !== serviceIds.length) {
      throw new BadRequestException('Duplicate services are not allowed.');
    }

    const barber = await this.fetchBarber(barberId);
    if (!barber.recurring_enabled) return unavailable;

    const services = await this.fetchServices(barberId, serviceIds);
    if (services.length !== serviceIds.length) return unavailable;
    // No early-out when recurring_price_usd is null on a service — we fall
    // back to that service's regular_price_usd so the slot stays bookable.

    const schedule = await this.fetchSchedule(barberId, dayOfWeek);
    if (!schedule || !schedule.recurring_enabled) return unavailable;

    const window = this.resolveDayWindow(schedule);
    if (!window) return unavailable;

    const frequencyOptions = this.resolveFrequencyOptions(schedule.recurring_frequency);
    if (frequencyOptions.length === 0) return unavailable;

    // Each service consumes one grid slot; service.duration_minutes is
    // metadata only. Block size is driven entirely by the schedule's grid.
    const totalDuration = services.length * schedule.slot_duration_minutes;

    const extraCharge =
      schedule.recurring_extra_charge_usd !== null &&
      schedule.recurring_extra_charge_usd !== undefined
        ? Number(schedule.recurring_extra_charge_usd)
        : 0;
    const summedServicePrice = services.reduce(
      (acc, s) => acc + this.recurringBasePrice(s),
      0,
    );
    const recurringPriceUsd = Number((summedServicePrice + extraCharge).toFixed(2));

    const slotTimes = this.generateSlotTimesForBlock(
      window.start,
      window.end,
      schedule.slot_duration_minutes,
      totalDuration,
    );

    const recurringBlocked = await this.fetchRecurringBlockedSlotTimes(
      barberId,
      dayOfWeek,
      schedule.slot_duration_minutes,
    );
    const oneOffBlockedSlotMs = await this.fetchOneOffBlockedSlotMs(
      barberId,
      dayOfWeek,
      barber.timezone,
      slotTimes,
      schedule.slot_duration_minutes,
      totalDuration,
    );

    const slots: RecurringSlotDto[] = slotTimes.map((time) => {
      const slotStartMin = timeToMinutes(time);
      // services.length grid slots, back-to-back from the candidate start.
      // A slot is unavailable if any of those positions collides with
      // another recurring subscription or one-off booking.
      for (let k = 0; k < services.length; k++) {
        const gridTime = minutesToTime(
          slotStartMin + k * schedule.slot_duration_minutes,
        );
        if (recurringBlocked.has(gridTime)) return { time, available: false };
        if (oneOffBlockedSlotMs.has(gridTime)) return { time, available: false };
      }
      return { time, available: true };
    });

    return {
      dayOfWeek,
      recurringAvailable: true,
      recurringFrequencyOptions: frequencyOptions,
      recurringPriceUsd,
      totalDurationMinutes: totalDuration,
      slots,
    };
  }

  private async fetchServices(
    barberId: string,
    serviceIds: string[],
  ): Promise<BarberServiceRow[]> {
    if (serviceIds.length === 0) return [];
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

  private async fetchBarber(barberId: string): Promise<BarberRow> {
    const { data, error } = await this.db
      .from('barbers')
      .select('user_id, timezone, recurring_enabled')
      .eq('user_id', barberId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to fetch barber');
    if (!data) throw new NotFoundException('Barber not found');

    return data as BarberRow;
  }

  private async fetchService(
    barberId: string,
    serviceId: string,
  ): Promise<BarberServiceRow | null> {
    const { data, error } = await this.db
      .from('barber_services')
      .select(
        'id, barber_id, name, service_type, duration_minutes, regular_price_usd, recurring_price_usd, is_active',
      )
      .eq('id', serviceId)
      .eq('barber_id', barberId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to fetch service');
    return (data as BarberServiceRow | null) ?? null;
  }

  private async fetchSchedule(
    barberId: string,
    dayOfWeek: number,
  ): Promise<ScheduleRow | null> {
    const { data, error } = await this.db
      .from('barber_schedules')
      .select(
        'barber_id, day_of_week, is_working, regular_start_time, regular_end_time, slot_duration_minutes, day_off_booking_enabled, day_off_start_time, day_off_end_time, recurring_enabled, recurring_frequency, recurring_extra_charge_usd',
      )
      .eq('barber_id', barberId)
      .eq('day_of_week', dayOfWeek)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to fetch schedule');
    return (data as ScheduleRow | null) ?? null;
  }

  private resolveDayWindow(
    schedule: ScheduleRow,
  ): { start: string; end: string } | null {
    if (schedule.is_working) {
      if (!schedule.regular_start_time || !schedule.regular_end_time) return null;
      return {
        start: this.trimTime(schedule.regular_start_time),
        end: this.trimTime(schedule.regular_end_time),
      };
    }
    if (schedule.day_off_booking_enabled) {
      if (!schedule.day_off_start_time || !schedule.day_off_end_time) return null;
      return {
        start: this.trimTime(schedule.day_off_start_time),
        end: this.trimTime(schedule.day_off_end_time),
      };
    }
    return null;
  }

  private resolveFrequencyOptions(
    raw: RecurringFrequencyOption | null,
  ): RecurringFrequency[] {
    if (raw === 'weekly') return ['weekly'];
    if (raw === 'biweekly') return ['biweekly'];
    if (raw === 'both') return ['weekly', 'biweekly'];
    return [];
  }

  // Candidate block starts: aligned to the day's slot grid and guaranteed to
  // fit the combined `totalDuration` before the window ends. Starts where the
  // block would overshoot the window are NOT emitted — they can never be
  // bookable regardless of conflicts.
  private generateSlotTimesForBlock(
    start: string,
    end: string,
    stepMin: number,
    totalDuration: number,
  ): string[] {
    const startM = timeToMinutes(start);
    const endM = timeToMinutes(end);
    const times: string[] = [];
    for (let m = startM; m + totalDuration <= endM; m += stepMin) {
      times.push(minutesToTime(m));
    }
    return times;
  }

  // Expand each existing recurring subscription into the set of grid-slot
  // times it occupies, so a multi-slot recurring blocks every grid position
  // within [slot_time, slot_time + duration_minutes).
  private async fetchRecurringBlockedSlotTimes(
    barberId: string,
    dayOfWeek: number,
    slotDurationMinutes: number,
  ): Promise<Set<string>> {
    const { data, error } = await this.db
      .from('recurring_bookings')
      .select('slot_time, duration_minutes')
      .eq('barber_id', barberId)
      .eq('day_of_week', dayOfWeek)
      .in('status', ['pending_barber_approval', 'active', 'paused']);

    if (error) throw new InternalServerErrorException('Failed to fetch recurring conflicts');
    const blocked = new Set<string>();
    for (const r of data ?? []) {
      const startM = timeToMinutes(this.trimTime(r.slot_time as string));
      const duration = (r.duration_minutes as number | null) ?? slotDurationMinutes;
      for (let m = startM; m < startM + duration; m += slotDurationMinutes) {
        blocked.add(minutesToTime(m));
      }
    }
    return blocked;
  }

  // For each grid slot time on this day-of-week (across the next 60 days),
  // check whether any one-off booking occupies it. Existing bookings are
  // expanded by their own duration so a 60-min booking at 14:00 blocks both
  // the 14:00 and 14:30 grid slots on a 30-min grid.
  private async fetchOneOffBlockedSlotMs(
    barberId: string,
    dayOfWeek: number,
    timezone: string,
    slotTimes: string[],
    slotDurationMinutes: number,
    totalDuration: number,
  ): Promise<Set<string>> {
    const blockedTimes = new Set<string>();
    if (slotTimes.length === 0) return blockedTimes;

    const todayLocal = localDateInTz(new Date(), timezone);
    const matchingDates = nextMatchingDates(todayLocal, dayOfWeek, RECURRING_WINDOW_DAYS);
    if (matchingDates.length === 0) return blockedTimes;

    // Build the set of candidate grid-slot start ms we need to check. For each
    // candidate block start we also include every grid slot inside the block
    // (since the block can collide with the middle/end of an existing
    // booking, not just the start).
    const slotsNeeded = Math.max(1, Math.ceil(totalDuration / slotDurationMinutes));
    const msToSlotTime = new Map<number, string>();
    const candidates: number[] = [];
    for (const date of matchingDates) {
      for (const time of slotTimes) {
        const startMin = timeToMinutes(time);
        for (let k = 0; k < slotsNeeded; k++) {
          const gridMin = startMin + k * slotDurationMinutes;
          const gridTime = minutesToTime(gridMin);
          const ms = composeUtcFromLocal(date, gridTime, timezone).getTime();
          const rounded = Math.floor(ms / MINUTE_MS) * MINUTE_MS;
          if (!msToSlotTime.has(rounded)) {
            msToSlotTime.set(rounded, gridTime);
            candidates.push(rounded);
          }
        }
      }
    }
    if (candidates.length === 0) return blockedTimes;

    const minMs = Math.min(...candidates);
    const maxMs = Math.max(...candidates);

    // Fetch every non-cancelled one-off booking (recurring_booking_id IS NULL)
    // whose interval overlaps our candidate range. Use a conservative 4h
    // window-lead so we catch bookings that started earlier but still run
    // into one of our candidate grid slots.
    const leadMs = 4 * 60 * 60_000;
    const { data, error } = await this.db
      .from('bookings')
      .select('scheduled_at, duration_minutes')
      .eq('barber_id', barberId)
      .is('recurring_booking_id', null)
      .gte('scheduled_at', new Date(minMs - leadMs).toISOString())
      .lte('scheduled_at', new Date(maxMs).toISOString())
      .neq('status', 'cancelled');

    if (error) throw new InternalServerErrorException('Failed to fetch one-off conflicts');

    for (const row of data ?? []) {
      const startMs = new Date(row.scheduled_at as string).getTime();
      const duration = (row.duration_minutes as number | null) ?? slotDurationMinutes;
      const endMs = startMs + duration * MINUTE_MS;
      const startKey = Math.floor(startMs / MINUTE_MS) * MINUTE_MS;
      for (let ms = startKey; ms < endMs; ms += slotDurationMinutes * MINUTE_MS) {
        const match = msToSlotTime.get(ms);
        if (match) blockedTimes.add(match);
      }
    }
    return blockedTimes;
  }

  private trimTime(value: string): string {
    return value.substring(0, 5);
  }

  // ────────────────────────────────────────────────────────────
  // R6 — Client creates a recurring booking request
  // ────────────────────────────────────────────────────────────

  public async createRecurringBooking(
    clientAuthId: string,
    dto: CreateRecurringBookingDto,
  ): Promise<RecurringBookingResponseDto> {
    // TODO: enforce client subscription_status === 'active' before allowing
    // a recurring request. Gated until subscription gating ships.
    return this.createRecurringInternal({
      clientAuthId,
      barberId: dto.barberId,
      services: dto.services,
      dayOfWeek: dto.dayOfWeek,
      slotTime: dto.slotTime,
      frequency: dto.frequency,
      autoAccept: false,
    });
  }

  // Barber-initiated arrangement: same validation as the client path, but the
  // barber is implicitly accepting the offer so we land it as `active` and
  // generate the 60-day window immediately.
  public async createRecurringByBarber(
    barberAuthId: string,
    dto: CreateBarberRecurringBookingDto,
  ): Promise<RecurringBookingResponseDto> {
    // Verify the chosen client exists. We never trust the barber's input.
    const { data: clientRow, error: clientErr } = await this.db
      .from('clients')
      .select('user_id')
      .eq('user_id', dto.clientId)
      .maybeSingle();
    if (clientErr) throw new InternalServerErrorException('Failed to fetch client');
    if (!clientRow) throw new NotFoundException('Client not found');

    return this.createRecurringInternal({
      clientAuthId: dto.clientId,
      barberId: barberAuthId,
      services: dto.services,
      dayOfWeek: dto.dayOfWeek,
      slotTime: dto.slotTime,
      frequency: dto.frequency,
      autoAccept: true,
    });
  }

  // Shared validation + insertion path for both client- and barber-initiated
  // recurring booking creation. autoAccept=true skips the offer step and
  // synchronously generates the 60-day window.
  private async createRecurringInternal(args: {
    clientAuthId: string;
    barberId: string;
    services: { barberServiceId: string; bookingType: BookingTypeDto | string }[];
    dayOfWeek: number;
    slotTime: string;
    frequency: RecurringBookingFrequency | 'weekly' | 'biweekly';
    autoAccept: boolean;
  }): Promise<RecurringBookingResponseDto> {
    const {
      clientAuthId,
      barberId,
      services: selections,
      dayOfWeek,
      slotTime,
      frequency,
      autoAccept,
    } = args;

    const barber = await this.fetchBarber(barberId);
    if (!barber.recurring_enabled) {
      throw new BadRequestException('This barber is not accepting recurring bookings.');
    }

    const requestedIds = selections.map((s) => s.barberServiceId);
    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new BadRequestException('Duplicate services are not allowed.');
    }

    const services = await this.fetchServices(barberId, requestedIds);
    if (services.length !== requestedIds.length) {
      throw new NotFoundException('One or more services were not found or inactive for this barber');
    }
    // Services without an explicit recurring_price_usd are billed at their
    // regular_price_usd — same fallback rule as one-off bookings.

    const schedule = await this.fetchSchedule(barberId, dayOfWeek);
    if (!schedule || !schedule.recurring_enabled) {
      throw new BadRequestException('This day is not available for recurring bookings.');
    }

    if (!this.isFrequencyAllowed(schedule.recurring_frequency, frequency)) {
      throw new BadRequestException('This frequency is not available for this day.');
    }

    const window = this.resolveDayWindow(schedule);
    if (!window) {
      throw new BadRequestException('This day has no bookable hours configured.');
    }

    // Block size is slot-driven: services.length × schedule grid step.
    const slotStep = schedule.slot_duration_minutes;
    const totalDuration = services.length * slotStep;
    const minutes = timeToMinutes(slotTime);
    const startM = timeToMinutes(window.start);
    const endM = timeToMinutes(window.end);
    if (minutes < startM || minutes + totalDuration > endM) {
      throw new BadRequestException('The selected services do not fit the bookable window for this day.');
    }
    if ((minutes - startM) % slotStep !== 0) {
      throw new BadRequestException("slotTime does not align to the day's slot grid.");
    }

    const extraCharge =
      schedule.recurring_extra_charge_usd !== null &&
      schedule.recurring_extra_charge_usd !== undefined
        ? Number(schedule.recurring_extra_charge_usd)
        : 0;

    // Extra charge is per-occurrence, not per-service. Distribute it onto the
    // first service's slot_type_surcharge_usd so the aggregate matches
    // `recurring_bookings.price_usd`.
    const perServicePricing = selections.map((selection, idx) => {
      const svc = services.find((s) => s.id === selection.barberServiceId)!;
      const basePrice = this.recurringBasePrice(svc);
      const surcharge = idx === 0 ? extraCharge : 0;
      const totalPrice = Number((basePrice + surcharge).toFixed(2));
      return {
        selection,
        service: svc,
        basePrice,
        surcharge,
        totalPrice,
      };
    });

    const priceUsd = Number(
      perServicePricing.reduce((acc, p) => acc + p.totalPrice, 0).toFixed(2),
    );

    const normalisedSlotTime = `${slotTime}:00`;
    const primary = services.find((s) => s.id === selections[0].barberServiceId)!;

    const nowIso = new Date().toISOString();
    const initialStatus = autoAccept ? 'active' : 'pending_barber_approval';
    const today = autoAccept ? localDateInTz(new Date(), barber.timezone) : null;

    const { data: inserted, error } = await this.db
      .from('recurring_bookings')
      .insert({
        client_id: clientAuthId,
        barber_id: barberId,
        barber_service_id: primary.id,
        day_of_week: dayOfWeek,
        slot_time: normalisedSlotTime,
        frequency,
        price_usd: priceUsd,
        duration_minutes: totalDuration,
        status: initialStatus,
        is_renewal: false,
        ...(autoAccept ? { barber_accepted_at: nowIso, window_start_date: today } : {}),
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('This recurring slot is already taken.');
      }
      throw new InternalServerErrorException('Failed to create recurring booking');
    }

    const insertedRow = inserted as RecurringRow;

    // duration_minutes on the snapshot is the SLOT share (drives math). The
    // service's nominal duration is fetched fresh from barber_services when
    // we render the response.
    const childRows = perServicePricing.map((p, idx) => ({
      recurring_booking_id: insertedRow.id,
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
      await this.db.from('recurring_bookings').delete().eq('id', insertedRow.id);
      throw new InternalServerErrorException('Failed to create recurring booking services');
    }

    if (autoAccept) {
      try {
        await this.generator.generate(insertedRow.id);
      } catch (genErr) {
        // Roll the row back to pending so we don't leave an `active` row with
        // zero generated occurrences (consistent with acceptRecurringBooking).
        await this.db
          .from('recurring_bookings')
          .update({
            status: 'pending_barber_approval',
            barber_accepted_at: null,
            window_start_date: null,
          })
          .eq('id', insertedRow.id);
        throw new InternalServerErrorException(
          `Failed to generate recurring occurrences after auto-accept: ${
            genErr instanceof Error ? genErr.message : 'unknown error'
          }`,
        );
      }
      // Notify the client that their recurring is live.
      void this.notificationsService.createAndSendNotification({
        recipientId: insertedRow.client_id,
        recipientType: 'client',
        senderId: barberId,
        type: NotificationTypeDto.RECURRING_ACCEPTED,
        recurringBookingId: insertedRow.id,
      });
    } else {
      void this.notificationsService.createAndSendNotification({
        recipientId: insertedRow.barber_id,
        recipientType: 'barber',
        senderId: clientAuthId,
        type: NotificationTypeDto.NEW_RECURRING_REQUEST,
        recurringBookingId: insertedRow.id,
      });
    }

    return { recurringBooking: await this.buildRecurringBookingDto(insertedRow) };
  }

  // ────────────────────────────────────────────────────────────
  // R7 — Barber accepts or declines a pending recurring offer
  // ────────────────────────────────────────────────────────────

  public async acceptRecurringBooking(
    barberAuthId: string,
    recurringBookingId: string,
  ): Promise<RecurringBookingResponseDto> {
    const row = await this.fetchRecurringForBarber(barberAuthId, recurringBookingId);
    if (row.status !== 'pending_barber_approval') {
      throw new BadRequestException('This offer is no longer pending.');
    }

    const nowIso = new Date().toISOString();
    const today = localDateInTz(new Date(), await this.fetchBarberTimezone(row.barber_id));

    const { data: updated, error } = await this.db
      .from('recurring_bookings')
      .update({
        status: 'active',
        barber_accepted_at: nowIso,
        window_start_date: today,
      })
      .eq('id', recurringBookingId)
      .eq('barber_id', barberAuthId)
      .eq('status', 'pending_barber_approval')
      .select('*')
      .single();

    if (error || !updated) {
      throw new InternalServerErrorException('Failed to accept recurring booking');
    }

    try {
      await this.generator.generate(recurringBookingId);
    } catch (genErr) {
      // Roll the row back to pending so a hard-failed generate never leaves
      // an `active` arrangement with zero occupancy.
      await this.db
        .from('recurring_bookings')
        .update({
          status: 'pending_barber_approval',
          barber_accepted_at: null,
          window_start_date: null,
        })
        .eq('id', recurringBookingId);
      throw new InternalServerErrorException(
        `Failed to generate recurring occurrences after acceptance: ${
          genErr instanceof Error ? genErr.message : 'unknown error'
        }`,
      );
    }

    const updatedRow = updated as RecurringRow;
    void this.notificationsService.createAndSendNotification({
      recipientId: updatedRow.client_id,
      recipientType: 'client',
      senderId: barberAuthId,
      type: NotificationTypeDto.RECURRING_ACCEPTED,
      recurringBookingId: updatedRow.id,
    });

    return { recurringBooking: await this.buildRecurringBookingDto(updatedRow) };
  }

  public async declineRecurringBooking(
    barberAuthId: string,
    recurringBookingId: string,
    dto: DeclineRecurringBookingDto,
  ): Promise<RecurringBookingResponseDto> {
    const row = await this.fetchRecurringForBarber(barberAuthId, recurringBookingId);
    if (row.status !== 'pending_barber_approval') {
      throw new BadRequestException('This offer is no longer pending.');
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error } = await this.db
      .from('recurring_bookings')
      .update({
        status: 'cancelled',
        barber_declined_at: nowIso,
        cancelled_at: nowIso,
        cancelled_by: 'barber',
        declined_reason: dto.reason ?? null,
      })
      .eq('id', recurringBookingId)
      .eq('barber_id', barberAuthId)
      .eq('status', 'pending_barber_approval')
      .select('*')
      .single();

    if (error || !updated) {
      throw new InternalServerErrorException('Failed to decline recurring booking');
    }

    const updatedRow = updated as RecurringRow;
    void this.notificationsService.createAndSendNotification({
      recipientId: updatedRow.client_id,
      recipientType: 'client',
      senderId: barberAuthId,
      type: NotificationTypeDto.RECURRING_REFUSED,
      recurringBookingId: updatedRow.id,
    });

    return { recurringBooking: await this.buildRecurringBookingDto(updatedRow) };
  }

  // ────────────────────────────────────────────────────────────
  // R12 — List recurring bookings (shared client + barber)
  // ────────────────────────────────────────────────────────────

  public async listRecurringBookingsForClient(
    clientAuthId: string,
    query: ListRecurringBookingsQueryDto,
  ): Promise<RecurringBookingsListResponseDto> {
    return this.listRecurringBookings({ clientId: clientAuthId }, query);
  }

  public async listRecurringBookingsForBarber(
    barberAuthId: string,
    query: ListRecurringBookingsQueryDto,
  ): Promise<RecurringBookingsListResponseDto> {
    return this.listRecurringBookings({ barberId: barberAuthId }, query);
  }

  // Page-based client recurring list (Feature 5 — /client/bookings/recurring).
  // Only surfaces the three client-facing statuses (active, paused, pending_approval)
  // and enriches each row with the next scheduled booking + remaining count.
  public async listClientRecurringForClient(
    clientAuthId: string,
    query: ClientBookingsPageQueryDto,
  ): Promise<ClientRecurringBookingsListResponseDto> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 10, 50);
    const visibleStatuses = ['pending_barber_approval', 'active', 'paused'];

    const { count, error: countErr } = await this.db
      .from('recurring_bookings')
      .select('id', { head: true, count: 'exact' })
      .eq('client_id', clientAuthId)
      .in('status', visibleStatuses);

    if (countErr) throw new InternalServerErrorException('Failed to count recurring bookings');

    const totalBookings = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalBookings / limit));
    const startIndex = (page - 1) * limit;

    const { data, error } = await this.db
      .from('recurring_bookings')
      .select('*')
      .eq('client_id', clientAuthId)
      .in('status', visibleStatuses)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(startIndex, startIndex + limit - 1);

    if (error) throw new InternalServerErrorException('Failed to fetch recurring bookings');

    const rows = (data ?? []) as RecurringRow[];

    const recurringIds = rows.map((r) => r.id);
    const [nextOccurrenceMap, appointmentsLeftMap] = await Promise.all([
      this.loadNextOccurrenceRecord(recurringIds),
      this.loadAppointmentsLeft(recurringIds),
    ]);

    const bookings: ClientRecurringBookingListItemDto[] = await Promise.all(
      rows.map(async (row) => {
        const [barberInfo, serviceLite] = await Promise.all([
          this.fetchBarberNameAndPhoto(row.barber_id),
          this.fetchServiceLite(row.barber_service_id),
        ]);
        const next = nextOccurrenceMap.get(row.id);
        const timezone = await this.fetchBarberTimezone(row.barber_id);
        const local = next
          ? splitLocalDateTime(next.scheduled_at, timezone)
          : { date: null, time: null };

        return {
          id: row.id,
          barberName: barberInfo.name,
          barberProfileImage: barberInfo.profilePhotoUrl,
          serviceName: serviceLite.name,
          nextAppointmentDate: local.date,
          appointmentTime: local.time,
          durationMinutes: serviceLite.durationMinutes,
          bookingStatus: (next?.status as BookingStatusDto | undefined) ?? null,
          recurringStatus: this.mapRecurringStatus(row.status),
          appointmentsLeft: appointmentsLeftMap.get(row.id) ?? 0,
        };
      }),
    );

    // Secondary sort: nearest upcoming next-appointment first
    bookings.sort((a, b) => {
      if (a.nextAppointmentDate && b.nextAppointmentDate) {
        return a.nextAppointmentDate.localeCompare(b.nextAppointmentDate);
      }
      if (a.nextAppointmentDate) return -1;
      if (b.nextAppointmentDate) return 1;
      return 0;
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

  private async loadNextOccurrenceRecord(
    recurringIds: string[],
  ): Promise<Map<string, { scheduled_at: string; status: string }>> {
    const result = new Map<string, { scheduled_at: string; status: string }>();
    if (recurringIds.length === 0) return result;

    const nowIso = new Date().toISOString();
    const { data, error } = await this.db
      .from('bookings')
      .select('recurring_booking_id, scheduled_at, status')
      .in('recurring_booking_id', recurringIds)
      .gte('scheduled_at', nowIso)
      .in('status', ['pending', 'confirmed'])
      .order('scheduled_at', { ascending: true });

    if (error) throw new InternalServerErrorException('Failed to fetch next occurrences');

    for (const row of data ?? []) {
      const id = row.recurring_booking_id as string;
      if (!result.has(id)) {
        result.set(id, {
          scheduled_at: row.scheduled_at as string,
          status: row.status as string,
        });
      }
    }
    return result;
  }

  private async loadAppointmentsLeft(recurringIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (recurringIds.length === 0) return result;

    const nowIso = new Date().toISOString();
    const { data, error } = await this.db
      .from('bookings')
      .select('recurring_booking_id')
      .in('recurring_booking_id', recurringIds)
      .gte('scheduled_at', nowIso)
      .in('status', ['pending', 'confirmed']);

    if (error) throw new InternalServerErrorException('Failed to count remaining occurrences');

    for (const id of recurringIds) result.set(id, 0);
    for (const row of data ?? []) {
      const id = row.recurring_booking_id as string;
      result.set(id, (result.get(id) ?? 0) + 1);
    }
    return result;
  }

  private async fetchBarberNameAndPhoto(
    barberId: string,
  ): Promise<{ name: string; profilePhotoUrl: string | null }> {
    const { data } = await this.db
      .from('barbers')
      .select('full_name, profile_photo_url')
      .eq('user_id', barberId)
      .maybeSingle();
    return {
      name: (data?.full_name as string | undefined) ?? 'Unknown',
      profilePhotoUrl: (data?.profile_photo_url as string | null) ?? null,
    };
  }

  private mapRecurringStatus(dbStatus: string): ClientRecurringStatusDto {
    if (dbStatus === 'active') return ClientRecurringStatusDto.ACTIVE;
    if (dbStatus === 'paused') return ClientRecurringStatusDto.PAUSED;
    return ClientRecurringStatusDto.PENDING_APPROVAL;
  }


  private async listRecurringBookings(
    owner: { clientId?: string; barberId?: string },
    query: ListRecurringBookingsQueryDto,
  ): Promise<RecurringBookingsListResponseDto> {
    const limit = Math.min(query.limit ?? 20, 50);
    let q = this.db.from('recurring_bookings').select('*');
    if (owner.clientId) q = q.eq('client_id', owner.clientId);
    if (owner.barberId) q = q.eq('barber_id', owner.barberId);
    if (query.status) q = q.eq('status', query.status);

    const cursor = await this.resolveRecurringCursor(owner, query.cursor);
    if (cursor) {
      q = q.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    q = q
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const { data, error } = await q;
    if (error) throw new InternalServerErrorException('Failed to fetch recurring bookings');

    const rows = (data ?? []) as RecurringRow[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const nextOccurrenceByRecurringId = await this.loadNextOccurrenceAt(
      pageRows.map((r) => r.id),
    );

    const items: RecurringBookingListItemDto[] = await Promise.all(
      pageRows.map(async (row) => {
        const [barberName, clientName, serviceLite] = await Promise.all([
          this.fetchBarberName(row.barber_id),
          this.fetchClientName(row.client_id),
          this.fetchServiceLite(row.barber_service_id),
        ]);
        return {
          id: row.id,
          status: row.status as RecurringBookingStatus,
          isRenewal: row.is_renewal,
          dayOfWeek: row.day_of_week,
          slotTime: this.trimTime(row.slot_time),
          frequency: row.frequency,
          priceUsd: Number(row.price_usd),
          service: serviceLite,
          barber: { id: row.barber_id, name: barberName },
          client: { id: row.client_id, name: clientName },
          nextOccurrenceAt: nextOccurrenceByRecurringId.get(row.id) ?? null,
          createdAt: new Date(row.created_at).toISOString(),
        };
      }),
    );

    return {
      recurringBookings: items,
      nextCursor: hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
      hasMore,
    };
  }

  private async resolveRecurringCursor(
    owner: { clientId?: string; barberId?: string },
    cursor?: string,
  ): Promise<{ id: string; created_at: string } | null> {
    if (!cursor) return null;
    let q = this.db.from('recurring_bookings').select('id, created_at').eq('id', cursor);
    if (owner.clientId) q = q.eq('client_id', owner.clientId);
    if (owner.barberId) q = q.eq('barber_id', owner.barberId);
    const { data, error } = await q.maybeSingle();
    if (error) throw new InternalServerErrorException('Failed to resolve cursor');
    if (!data) return null;
    return { id: data.id as string, created_at: data.created_at as string };
  }

  private async loadNextOccurrenceAt(
    recurringIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (recurringIds.length === 0) return result;

    const nowIso = new Date().toISOString();
    const { data, error } = await this.db
      .from('bookings')
      .select('recurring_booking_id, scheduled_at, status')
      .in('recurring_booking_id', recurringIds)
      .gte('scheduled_at', nowIso)
      .in('status', ['pending', 'confirmed'])
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

  // ────────────────────────────────────────────────────────────
  // R11 — Client renews a recurring booking
  // ────────────────────────────────────────────────────────────

  public async renewRecurringBooking(
    clientAuthId: string,
    originalId: string,
  ): Promise<RecurringBookingResponseDto> {
    const original = await this.fetchRecurringForOwner(clientAuthId, 'client', originalId);

    if (original.status === 'cancelled') {
      throw new BadRequestException('This recurring booking cannot be renewed.');
    }

    // Block if a renewal is already in flight
    const { count, error: renewalCheckError } = await this.db
      .from('recurring_bookings')
      .select('id', { head: true, count: 'exact' })
      .eq('original_recurring_booking_id', originalId)
      .in('status', ['pending_barber_approval', 'active', 'paused']);

    if (renewalCheckError) {
      throw new InternalServerErrorException('Failed to check for existing renewals');
    }
    if ((count ?? 0) > 0) {
      throw new ConflictException('A renewal for this booking is already in progress.');
    }

    // Re-validate barber/day eligibility at renewal time
    const barber = await this.fetchBarber(original.barber_id);
    if (!barber.recurring_enabled) {
      throw new BadRequestException('This barber is no longer accepting recurring bookings.');
    }

    const originalServices = await this.fetchRecurringBookingServices(originalId);
    if (originalServices.length === 0) {
      // Legacy single-service rows pre-migration: fall back to barber_service_id
      originalServices.push({
        barber_service_id: original.barber_service_id,
        service_type: 'other',
        booking_type: 'regular',
        duration_minutes: 0,
        base_price_usd: 0,
        slot_type_surcharge_usd: 0,
        price_usd: 0,
        sort_order: 0,
      });
    }

    const currentServices = await this.fetchServices(
      original.barber_id,
      originalServices.map((s) => s.barber_service_id),
    );
    if (currentServices.length !== originalServices.length) {
      throw new BadRequestException('One or more services on the original booking are no longer active.');
    }
    // Same fallback rule on renewal: missing recurring_price_usd → priced
    // at the service's regular_price_usd.

    const schedule = await this.fetchSchedule(original.barber_id, original.day_of_week);
    if (!schedule || !schedule.recurring_enabled) {
      throw new BadRequestException('This day is no longer available for recurring bookings.');
    }

    if (!this.isFrequencyAllowed(schedule.recurring_frequency, original.frequency)) {
      throw new BadRequestException('This frequency is no longer available for this day.');
    }

    const extraCharge =
      schedule.recurring_extra_charge_usd !== null &&
      schedule.recurring_extra_charge_usd !== undefined
        ? Number(schedule.recurring_extra_charge_usd)
        : 0;

    // Rebuild pricing from current service prices (prices may have changed
    // since the original was created). Booking type is preserved per service.
    const currentById = new Map(currentServices.map((s) => [s.id, s]));
    const perServicePricing = originalServices.map((orig, idx) => {
      const svc = currentById.get(orig.barber_service_id)!;
      const basePrice = this.recurringBasePrice(svc);
      const surcharge = idx === 0 ? extraCharge : 0;
      const totalPrice = Number((basePrice + surcharge).toFixed(2));
      return {
        service: svc,
        bookingType: orig.booking_type,
        sortOrder: orig.sort_order,
        basePrice,
        surcharge,
        totalPrice,
      };
    });

    // Slot-driven block size — same rule as createRecurringBooking. Re-derive
    // from the current schedule's grid in case it changed since the original.
    const slotStep = schedule.slot_duration_minutes;
    const totalDuration = perServicePricing.length * slotStep;
    const priceUsd = Number(
      perServicePricing.reduce((acc, p) => acc + p.totalPrice, 0).toFixed(2),
    );

    const { data: inserted, error } = await this.db
      .from('recurring_bookings')
      .insert({
        client_id: clientAuthId,
        barber_id: original.barber_id,
        barber_service_id: original.barber_service_id,
        day_of_week: original.day_of_week,
        slot_time: original.slot_time,
        frequency: original.frequency,
        price_usd: priceUsd,
        duration_minutes: totalDuration,
        status: 'pending_barber_approval',
        is_renewal: true,
        original_recurring_booking_id: originalId,
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('This recurring slot is already taken.');
      }
      throw new InternalServerErrorException('Failed to create renewal');
    }

    const insertedRow = inserted as RecurringRow;

    const childRows = perServicePricing.map((p) => ({
      recurring_booking_id: insertedRow.id,
      barber_service_id: p.service.id,
      service_type: p.service.service_type,
      booking_type: p.bookingType,
      duration_minutes: slotStep,
      base_price_usd: p.basePrice,
      slot_type_surcharge_usd: p.surcharge,
      price_usd: p.totalPrice,
      sort_order: p.sortOrder,
    }));

    const { error: childError } = await this.db
      .from('recurring_booking_services')
      .insert(childRows);

    if (childError) {
      await this.db.from('recurring_bookings').delete().eq('id', insertedRow.id);
      throw new InternalServerErrorException('Failed to clone recurring booking services');
    }

    void this.notificationsService.createAndSendNotification({
      recipientId: insertedRow.barber_id,
      recipientType: 'barber',
      senderId: clientAuthId,
      type: NotificationTypeDto.NEW_RECURRING_REQUEST,
      recurringBookingId: insertedRow.id,
    });

    return { recurringBooking: await this.buildRecurringBookingDto(insertedRow) };
  }

  private async fetchRecurringBookingServices(
    recurringBookingId: string,
  ): Promise<RecurringBookingServiceSnapshot[]> {
    const { data, error } = await this.db
      .from('recurring_booking_services')
      .select(
        'barber_service_id, service_type, booking_type, duration_minutes, base_price_usd, slot_type_surcharge_usd, price_usd, sort_order',
      )
      .eq('recurring_booking_id', recurringBookingId)
      .order('sort_order', { ascending: true });

    if (error) throw new InternalServerErrorException('Failed to fetch recurring booking services');
    return (data ?? []) as RecurringBookingServiceSnapshot[];
  }

  // ────────────────────────────────────────────────────────────
  // R9 — Pause / Resume / Cancel (both roles share the logic)
  // ────────────────────────────────────────────────────────────

  public async pauseRecurringBooking(
    actorAuthId: string,
    role: 'client' | 'barber',
    recurringBookingId: string,
    dto: PauseRecurringBookingDto,
  ): Promise<RecurringBookingResponseDto> {
    const row = await this.fetchRecurringForOwner(actorAuthId, role, recurringBookingId);
    if (row.status !== 'active') {
      throw new BadRequestException('Only active recurring bookings can be paused.');
    }

    const barberTimezone = await this.fetchBarberTimezone(row.barber_id);
    const todayLocal = localDateInTz(new Date(), barberTimezone);
    if (dto.pauseStartDate < todayLocal) {
      throw new BadRequestException('Pause start date cannot be in the past.');
    }
    if (dto.pauseEndDate && dto.pauseEndDate < dto.pauseStartDate) {
      throw new BadRequestException('Pause end date cannot be before pause start date.');
    }

    const { data: updated, error } = await this.db
      .from('recurring_bookings')
      .update({
        status: 'paused',
        paused_by: role,
        pause_start_date: dto.pauseStartDate,
        pause_end_date: dto.pauseEndDate ?? null,
      })
      .eq('id', recurringBookingId)
      .eq('status', 'active')
      .select('*')
      .single();

    if (error || !updated) throw new InternalServerErrorException('Failed to pause recurring booking');

    await this.generator.cancelPausedBookings(recurringBookingId);

    const updatedRow = updated as RecurringRow;
    // Spec: only the client pausing/cancelling fires a barber-facing notification.
    // When the barber initiates the action themselves there is no counterpart event.
    if (role === 'client') {
      void this.notificationsService.createAndSendNotification({
        recipientId: updatedRow.barber_id,
        recipientType: 'barber',
        senderId: actorAuthId,
        type: NotificationTypeDto.RECURRING_PAUSED,
        recurringBookingId: updatedRow.id,
      });
    }

    return { recurringBooking: await this.buildRecurringBookingDto(updatedRow) };
  }

  public async resumeRecurringBooking(
    actorAuthId: string,
    role: 'client' | 'barber',
    recurringBookingId: string,
  ): Promise<RecurringBookingResponseDto> {
    const row = await this.fetchRecurringForOwner(actorAuthId, role, recurringBookingId);
    if (row.status !== 'paused') {
      throw new BadRequestException('Only paused recurring bookings can be resumed.');
    }

    // Capture the pause window BEFORE clearing it — restore relies on it to
    // identify which cancelled rows belong to this pause.
    const pauseStart = row.pause_start_date;
    const pauseEnd = row.pause_end_date;

    const { data: updated, error } = await this.db
      .from('recurring_bookings')
      .update({
        status: 'active',
        paused_by: null,
        pause_start_date: null,
        pause_end_date: null,
      })
      .eq('id', recurringBookingId)
      .eq('status', 'paused')
      .select('*')
      .single();

    if (error || !updated) throw new InternalServerErrorException('Failed to resume recurring booking');

    // 1) Restore previously-cancelled occurrences inside the pause window
    //    where the slot is still free. Conflicting slots are left cancelled.
    let restored = 0;
    let conflicted = 0;
    if (pauseStart) {
      const summary = await this.generator.restorePausedOccurrences(
        recurringBookingId,
        pauseStart,
        pauseEnd,
      );
      restored = summary.restored;
      conflicted = summary.conflicted;
    }

    // 2) Top up with any new dates that rolled into the rolling 60-day window
    //    while the recurring was paused. generate() skips dates that already
    //    have a row, so it composes safely with restore.
    await this.generator.generate(recurringBookingId);

    // Observability for the orchestrator step.
    // eslint-disable-next-line no-console
    console.log(
      `[recurring.resume] id=${recurringBookingId} restored=${restored} conflicted=${conflicted}`,
    );

    return { recurringBooking: await this.buildRecurringBookingDto(updated as RecurringRow) };
  }

  public async cancelRecurringBooking(
    actorAuthId: string,
    role: 'client' | 'barber',
    recurringBookingId: string,
  ): Promise<RecurringBookingResponseDto> {
    const row = await this.fetchRecurringForOwner(actorAuthId, role, recurringBookingId);
    if (row.status !== 'active' && row.status !== 'paused') {
      throw new BadRequestException('Cannot cancel this recurring booking.');
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error } = await this.db
      .from('recurring_bookings')
      .update({
        status: 'cancelled',
        cancelled_at: nowIso,
        cancelled_by: role,
      })
      .eq('id', recurringBookingId)
      .in('status', ['active', 'paused'])
      .select('*')
      .single();

    if (error || !updated) throw new InternalServerErrorException('Failed to cancel recurring booking');

    await this.generator.cancelFutureBookings(recurringBookingId, role);

    const updatedRow = updated as RecurringRow;
    // Same rule as pause: only the client cancelling notifies the barber.
    if (role === 'client') {
      void this.notificationsService.createAndSendNotification({
        recipientId: updatedRow.barber_id,
        recipientType: 'barber',
        senderId: actorAuthId,
        type: NotificationTypeDto.RECURRING_CANCELLED,
        recurringBookingId: updatedRow.id,
      });
    }

    return { recurringBooking: await this.buildRecurringBookingDto(updatedRow) };
  }

  private async fetchRecurringForOwner(
    actorAuthId: string,
    role: 'client' | 'barber',
    recurringBookingId: string,
  ): Promise<RecurringRow> {
    const column = role === 'client' ? 'client_id' : 'barber_id';
    const { data, error } = await this.db
      .from('recurring_bookings')
      .select('*')
      .eq('id', recurringBookingId)
      .eq(column, actorAuthId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to fetch recurring booking');
    if (!data) throw new NotFoundException('Recurring booking not found');
    return data as RecurringRow;
  }

  // ────────────────────────────────────────────────────────────
  // R8 — Recurring booking detail (client & barber share a shape)
  // ────────────────────────────────────────────────────────────

  public async getRecurringBookingForClient(
    clientAuthId: string,
    recurringBookingId: string,
  ): Promise<RecurringBookingDetailResponseDto> {
    return this.getRecurringBookingDetail(recurringBookingId, { clientId: clientAuthId });
  }

  public async getRecurringBookingForBarber(
    barberAuthId: string,
    recurringBookingId: string,
  ): Promise<RecurringBookingDetailResponseDto> {
    return this.getRecurringBookingDetail(recurringBookingId, { barberId: barberAuthId });
  }

  private async getRecurringBookingDetail(
    recurringBookingId: string,
    owner: { clientId?: string; barberId?: string },
  ): Promise<RecurringBookingDetailResponseDto> {
    let q = this.db.from('recurring_bookings').select('*').eq('id', recurringBookingId);
    if (owner.clientId) q = q.eq('client_id', owner.clientId);
    if (owner.barberId) q = q.eq('barber_id', owner.barberId);

    const { data, error } = await q.maybeSingle();

    if (error) throw new InternalServerErrorException('Failed to fetch recurring booking');
    if (!data) throw new NotFoundException('Recurring booking not found');

    const row = data as RecurringRow;
    const base = await this.buildRecurringBookingDto(row);

    const { pastOccurrences, upcomingOccurrences } = await this.loadOccurrences(row.id);

    return {
      recurringBooking: {
        ...base,
        pastOccurrences,
        upcomingOccurrences,
      },
    };
  }

  private async loadOccurrences(recurringBookingId: string): Promise<{
    pastOccurrences: RecurringOccurrenceDto[];
    upcomingOccurrences: RecurringOccurrenceDto[];
  }> {
    const nowIso = new Date().toISOString();

    const [{ data: pastData, error: pastError }, { data: upData, error: upError }] =
      await Promise.all([
        this.db
          .from('bookings')
          .select('id, scheduled_at, status')
          .eq('recurring_booking_id', recurringBookingId)
          .lt('scheduled_at', nowIso)
          .order('scheduled_at', { ascending: false }),
        this.db
          .from('bookings')
          .select('id, scheduled_at, status')
          .eq('recurring_booking_id', recurringBookingId)
          .gte('scheduled_at', nowIso)
          .order('scheduled_at', { ascending: true }),
      ]);

    if (pastError || upError) {
      throw new InternalServerErrorException('Failed to fetch occurrences');
    }

    const mapRow = (r: {
      id: string;
      scheduled_at: string;
      status: string;
    }): RecurringOccurrenceDto => ({
      bookingId: r.id,
      scheduledAt: new Date(r.scheduled_at).toISOString(),
      status: r.status,
    });

    return {
      pastOccurrences: (pastData ?? []).map((r) =>
        mapRow(r as { id: string; scheduled_at: string; status: string }),
      ),
      upcomingOccurrences: (upData ?? []).map((r) =>
        mapRow(r as { id: string; scheduled_at: string; status: string }),
      ),
    };
  }

  private async fetchRecurringForBarber(
    barberAuthId: string,
    recurringBookingId: string,
  ): Promise<RecurringRow> {
    const { data, error } = await this.db
      .from('recurring_bookings')
      .select('*')
      .eq('id', recurringBookingId)
      .eq('barber_id', barberAuthId)
      .maybeSingle();

    if (error) {
      console.error('[fetchRecurringForBarber] supabase error', {
        recurringBookingId,
        barberAuthId,
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      throw new InternalServerErrorException('Failed to fetch recurring booking');
    }
    if (!data) throw new NotFoundException('Recurring booking not found');
    return data as RecurringRow;
  }

  private async fetchBarberTimezone(barberId: string): Promise<string> {
    const { data, error } = await this.db
      .from('barbers')
      .select('timezone')
      .eq('user_id', barberId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException('Failed to fetch barber timezone');
    if (!data) throw new NotFoundException('Barber not found');
    return data.timezone as string;
  }

  private isFrequencyAllowed(
    dayOption: RecurringFrequencyOption | null,
    requested: RecurringBookingFrequency | 'weekly' | 'biweekly',
  ): boolean {
    if (!dayOption) return false;
    if (dayOption === 'both') return true;
    return dayOption === requested;
  }

  // A service may not have an explicit recurring_price_usd configured. In
  // that case we fall back to its regular_price_usd so the recurring slot
  // remains bookable — same policy used for missing after_hours / day_off
  // pricing on one-off bookings.
  private recurringBasePrice(s: BarberServiceRow): number {
    return Number(s.recurring_price_usd ?? s.regular_price_usd);
  }

  // Lightweight mapping from a recurring_bookings row + related barber/service/client
  // lookups into the public RecurringBookingDto. Used by R6, R7, R11, R12.
  protected async buildRecurringBookingDto(row: RecurringRow): Promise<RecurringBookingDto> {
    const [barberName, clientName, serviceLite, childServices] = await Promise.all([
      this.fetchBarberName(row.barber_id),
      this.fetchClientName(row.client_id),
      this.fetchServiceLite(row.barber_service_id),
      this.buildRecurringServiceList(row.id),
    ]);

    const totalDurationMinutes =
      row.duration_minutes ??
      childServices.reduce((acc, s) => acc + s.durationMinutes, 0) ??
      serviceLite.durationMinutes;

    return {
      id: row.id,
      status: row.status as RecurringBookingStatus,
      isRenewal: row.is_renewal,
      originalRecurringBookingId: row.original_recurring_booking_id,
      dayOfWeek: row.day_of_week,
      slotTime: this.trimTime(row.slot_time),
      frequency: row.frequency,
      priceUsd: Number(row.price_usd),
      pauseStartDate: row.pause_start_date,
      pauseEndDate: row.pause_end_date,
      windowStartDate: row.window_start_date,
      service: serviceLite,
      services: childServices,
      totalDurationMinutes,
      barber: { id: row.barber_id, name: barberName },
      client: { id: row.client_id, name: clientName },
      createdAt: new Date(row.created_at).toISOString(),
      barberAcceptedAt: row.barber_accepted_at
        ? new Date(row.barber_accepted_at).toISOString()
        : null,
      barberDeclinedAt: row.barber_declined_at
        ? new Date(row.barber_declined_at).toISOString()
        : null,
      declinedReason: row.declined_reason,
      cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
      cancelledBy: (row.cancelled_by as 'client' | 'barber' | null) ?? null,
    };
  }

  private async buildRecurringServiceList(
    recurringBookingId: string,
  ): Promise<RecurringBookingServiceDto[]> {
    const rows = await this.fetchRecurringBookingServices(recurringBookingId);
    if (rows.length === 0) return [];

    // recurring_booking_services.duration_minutes is the slot share (math).
    // For display we surface the service's real duration from barber_services.
    const serviceIds = rows.map((r) => r.barber_service_id);
    const { data, error } = await this.db
      .from('barber_services')
      .select('id, name, duration_minutes')
      .in('id', serviceIds);
    if (error) throw new InternalServerErrorException('Failed to fetch service names');
    const serviceById = new Map<string, { name: string; duration_minutes: number }>();
    for (const s of (data ?? []) as {
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
        priceUsd: Number(r.price_usd),
      };
    });
  }

  private async fetchBarberName(barberId: string): Promise<string> {
    const { data } = await this.db
      .from('barbers')
      .select('full_name')
      .eq('user_id', barberId)
      .maybeSingle();
    return ((data?.full_name as string | undefined) ?? 'Unknown');
  }

  private async fetchClientName(clientId: string): Promise<string> {
    const { data } = await this.db
      .from('clients')
      .select('name')
      .eq('user_id', clientId)
      .maybeSingle();
    return ((data?.name as string | undefined) ?? 'Unknown');
  }

  private async fetchServiceLite(
    serviceId: string,
  ): Promise<{ id: string; name: string; durationMinutes: number }> {
    const { data } = await this.db
      .from('barber_services')
      .select('id, name, duration_minutes')
      .eq('id', serviceId)
      .maybeSingle();
    return {
      id: serviceId,
      name: (data?.name as string | undefined) ?? 'Service',
      durationMinutes: (data?.duration_minutes as number | undefined) ?? 0,
    };
  }
}

// Row shape for recurring_bookings — internal to this module.
export interface RecurringRow {
  id: string;
  client_id: string;
  barber_id: string;
  barber_service_id: string;
  day_of_week: number;
  slot_time: string;
  frequency: 'weekly' | 'biweekly';
  price_usd: string | number;
  duration_minutes: number | null;
  status: string;
  is_renewal: boolean;
  original_recurring_booking_id: string | null;
  barber_accepted_at: string | null;
  barber_declined_at: string | null;
  declined_reason: string | null;
  paused_by: 'client' | 'barber' | null;
  pause_start_date: string | null;
  pause_end_date: string | null;
  window_start_date: string | null;
  last_booking_notification_sent_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  created_at: string;
  updated_at: string;
}
