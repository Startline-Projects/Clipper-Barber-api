import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { CreateBarberServiceDto } from './dto/create-barber-service.dto';
import { UpdateBarberServiceDto } from './dto/update-barber-service.dto';
import { ReorderBarberServicesDto } from './dto/reorder-barber-services.dto';
import { BarberServiceDto } from './dto/barber-service-response.dto';

interface RawBarberService {
  id: string;
  barber_id: string;
  name: string;
  service_type: string;
  duration_minutes: number;
  regular_price_usd: number;
  after_hours_price_usd: number | null;
  day_off_price_usd: number | null;
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
