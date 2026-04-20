import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { CreateBarberServiceDto } from './dto/create-barber-service.dto';
import { UpdateBarberServiceDto } from './dto/update-barber-service.dto';
import { ReorderBarberServicesDto } from './dto/reorder-barber-services.dto';
import { BarberServiceDto } from './dto/barber-service-response.dto';
import {
  ClientRecurringServiceItemDto,
  ClientRecurringServicesResponseDto,
} from './dto/client-recurring-services.dto';

interface RawBarberService {
  id: string;
  barber_id: string;
  name: string;
  service_type: string;
  duration_minutes: number;
  regular_price_usd: number;
  after_hours_price_usd: number | null;
  day_off_price_usd: number | null;
  recurring_price_usd: number | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class BarberServicesService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private mapRow(row: RawBarberService): BarberServiceDto {
    return {
      id: row.id,
      barberId: row.barber_id,
      name: row.name,
      serviceType: row.service_type as BarberServiceDto['serviceType'],
      durationMinutes: row.duration_minutes,
      regularPriceUsd: Number(row.regular_price_usd),
      afterHoursPriceUsd:
        row.after_hours_price_usd !== null ? Number(row.after_hours_price_usd) : null,
      dayOffPriceUsd: row.day_off_price_usd !== null ? Number(row.day_off_price_usd) : null,
      recurringPriceUsd:
        row.recurring_price_usd !== null ? Number(row.recurring_price_usd) : null,
      isActive: row.is_active,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public async resolveAndVerifyOwnership(authUserId: string, barberId: string): Promise<void> {
    const { data, error } = await this.db
      .from('barbers')
      .select('user_id')
      .eq('user_id', authUserId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Barber profile not found');
    }

    if (data.user_id !== barberId) {
      throw new ForbiddenException('You can only manage your own services');
    }
  }

  public async create(barberId: string, dto: CreateBarberServiceDto): Promise<BarberServiceDto> {
    const { data: maxRow } = await this.db
      .from('barber_services')
      .select('sort_order')
      .eq('barber_id', barberId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextSortOrder = maxRow ? (maxRow.sort_order as number) + 1 : 0;

    const { data, error } = await this.db
      .from('barber_services')
      .insert({
        barber_id: barberId,
        name: dto.name,
        service_type: dto.serviceType,
        duration_minutes: dto.durationMinutes,
        regular_price_usd: dto.regularPriceUsd,
        after_hours_price_usd: dto.afterHoursPriceUsd ?? null,
        day_off_price_usd: dto.dayOffPriceUsd ?? null,
        recurring_price_usd: dto.recurringPriceUsd ?? null,
        sort_order: nextSortOrder,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('A service with this name already exists');
      }
      throw error;
    }

    return this.mapRow(data as RawBarberService);
  }

  public async findAll(barberId: string): Promise<BarberServiceDto[]> {
    const { data, error } = await this.db
      .from('barber_services')
      .select('*')
      .eq('barber_id', barberId)
      .order('sort_order', { ascending: true });

    if (error) throw error;

    return (data as RawBarberService[]).map((row) => this.mapRow(row));
  }

  public async findOne(barberId: string, serviceId: string): Promise<BarberServiceDto> {
    const { data, error } = await this.db
      .from('barber_services')
      .select('*')
      .eq('id', serviceId)
      .eq('barber_id', barberId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new NotFoundException('Service not found');

    return this.mapRow(data as RawBarberService);
  }

  public async update(
    barberId: string,
    serviceId: string,
    dto: UpdateBarberServiceDto
  ): Promise<BarberServiceDto> {
    // Build only the fields that were provided
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.serviceType !== undefined) patch.service_type = dto.serviceType;
    if (dto.durationMinutes !== undefined) patch.duration_minutes = dto.durationMinutes;
    if (dto.regularPriceUsd !== undefined) patch.regular_price_usd = dto.regularPriceUsd;
    if ('afterHoursPriceUsd' in dto) patch.after_hours_price_usd = dto.afterHoursPriceUsd ?? null;
    if ('dayOffPriceUsd' in dto) patch.day_off_price_usd = dto.dayOffPriceUsd ?? null;
    if ('recurringPriceUsd' in dto) patch.recurring_price_usd = dto.recurringPriceUsd ?? null;
    if (dto.sortOrder !== undefined) patch.sort_order = dto.sortOrder;

    const { data, error } = await this.db
      .from('barber_services')
      .update(patch)
      .eq('id', serviceId)
      .eq('barber_id', barberId)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('A service with this name already exists');
      }
      throw error;
    }
    if (!data) throw new NotFoundException('Service not found');

    return this.mapRow(data as RawBarberService);
  }

  public async toggle(barberId: string, serviceId: string): Promise<BarberServiceDto> {
    const service = await this.findOne(barberId, serviceId);

    const { data, error } = await this.db
      .from('barber_services')
      .update({ is_active: !service.isActive, updated_at: new Date().toISOString() })
      .eq('id', serviceId)
      .eq('barber_id', barberId)
      .select()
      .single();

    if (error) throw error;

    return this.mapRow(data as RawBarberService);
  }

  public async findRecurringServicesForClient(
    barberId: string,
  ): Promise<ClientRecurringServicesResponseDto> {
    const { data: barberRow, error: barberError } = await this.db
      .from('barbers')
      .select('user_id, recurring_enabled')
      .eq('user_id', barberId)
      .maybeSingle();

    if (barberError) throw new InternalServerErrorException('Failed to fetch barber');
    if (!barberRow) throw new NotFoundException('Barber not found');

    if (!(barberRow.recurring_enabled as boolean)) {
      return { services: [] };
    }

    const { data: serviceRows, error: servicesError } = await this.db
      .from('barber_services')
      .select(
        'id, barber_id, name, service_type, duration_minutes, regular_price_usd, after_hours_price_usd, day_off_price_usd, recurring_price_usd, is_active, sort_order, created_at, updated_at',
      )
      .eq('barber_id', barberId)
      .eq('is_active', true)
      .not('recurring_price_usd', 'is', null)
      .order('sort_order', { ascending: true });

    if (servicesError) throw new InternalServerErrorException('Failed to fetch services');
    if (!serviceRows || serviceRows.length === 0) return { services: [] };

    const { data: scheduleRows, error: scheduleError } = await this.db
      .from('barber_schedules')
      .select('recurring_extra_charge_usd')
      .eq('barber_id', barberId)
      .eq('recurring_enabled', true);

    if (scheduleError) throw new InternalServerErrorException('Failed to fetch schedule');

    // Min surcharge across all recurring-enabled days (null -> 0 for the floor)
    let minExtraCharge: number | null = null;
    for (const r of scheduleRows ?? []) {
      const raw = r.recurring_extra_charge_usd as number | string | null;
      const extra = raw !== null && raw !== undefined ? Number(raw) : 0;
      if (minExtraCharge === null || extra < minExtraCharge) minExtraCharge = extra;
    }

    // If no recurring-enabled schedule day exists, nothing is actually bookable
    if (minExtraCharge === null) return { services: [] };

    const services: ClientRecurringServiceItemDto[] = (serviceRows as RawBarberService[]).map(
      (s) => ({
        id: s.id,
        name: s.name,
        serviceType: s.service_type as ClientRecurringServiceItemDto['serviceType'],
        durationMinutes: s.duration_minutes,
        regularPrice: Number(s.regular_price_usd),
        recurringPriceFrom: Number(
          (Number(s.recurring_price_usd) + (minExtraCharge ?? 0)).toFixed(2),
        ),
      }),
    );

    return { services };
  }

  public async reorder(
    barberId: string,
    dto: ReorderBarberServicesDto
  ): Promise<BarberServiceDto[]> {
    // Verify all service IDs belong to this barber before mutating
    const { data: existing, error: fetchError } = await this.db
      .from('barber_services')
      .select('id')
      .eq('barber_id', barberId)
      .in('id', dto.serviceIds);

    if (fetchError) throw fetchError;

    if (!existing || existing.length !== dto.serviceIds.length) {
      throw new NotFoundException('One or more service IDs not found for this barber');
    }

    // Apply sort_order = index for each ID
    const updates = dto.serviceIds.map((id, index) =>
      this.db
        .from('barber_services')
        .update({ sort_order: index, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('barber_id', barberId)
    );

    await Promise.all(updates);

    return this.findAll(barberId);
  }
}
