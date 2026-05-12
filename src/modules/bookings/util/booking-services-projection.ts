// Pure projection helpers shared between the barber/client booking
// endpoints. Given the raw booking_services rows (sorted by sort_order)
// and a service-id → metadata map, emit the API-shape array — including
// a stable startOffsetMinutes derived as the running sum of slot shares.
//
// When `rows` is empty we fall back to a single-item array built from the
// legacy `bookings.barber_service_id` FK, so bookings predating the
// multi-service migration still serialize cleanly.

import { BookingTypeDto } from '../dto/preview-booking.dto';

export interface BookingServiceRow {
  barber_service_id: string;
  booking_type: string;
  duration_minutes: number;
}

export interface ServiceMetadata {
  name: string;
  duration_minutes: number;
}

export interface ProjectedBookingService {
  id: string;
  name: string;
  durationMinutes: number;
  bookingType: BookingTypeDto;
  startOffsetMinutes: number;
}

export function projectBookingServices(
  rows: BookingServiceRow[],
  legacyServiceId: string | null,
  serviceMap: Map<string, ServiceMetadata>
): ProjectedBookingService[] {
  if (rows.length === 0) {
    if (!legacyServiceId) return [];
    const svc = serviceMap.get(legacyServiceId);
    return [
      {
        id: legacyServiceId,
        name: svc?.name ?? 'Service',
        durationMinutes: svc?.duration_minutes ?? 0,
        bookingType: BookingTypeDto.REGULAR,
        startOffsetMinutes: 0,
      },
    ];
  }

  let offset = 0;
  return rows.map((r) => {
    const startOffsetMinutes = offset;
    offset += r.duration_minutes;
    const svc = serviceMap.get(r.barber_service_id);
    return {
      id: r.barber_service_id,
      name: svc?.name ?? 'Service',
      durationMinutes: svc?.duration_minutes ?? r.duration_minutes,
      bookingType: r.booking_type as BookingTypeDto,
      startOffsetMinutes,
    };
  });
}
