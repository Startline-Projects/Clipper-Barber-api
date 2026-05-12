import { BookingTypeDto } from '../dto/preview-booking.dto';
import {
  BookingServiceRow,
  ServiceMetadata,
  projectBookingServices,
} from './booking-services-projection';

const HAIRCUT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BEARD_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const LINEUP_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function buildServiceMap(): Map<string, ServiceMetadata> {
  return new Map<string, ServiceMetadata>([
    [HAIRCUT_ID, { name: 'Haircut', duration_minutes: 30 }],
    [BEARD_ID, { name: 'Beard', duration_minutes: 30 }],
    [LINEUP_ID, { name: 'Line Up', duration_minutes: 15 }],
  ]);
}

describe('projectBookingServices', () => {
  it('emits one entry per booking_services row with running startOffsetMinutes', () => {
    const rows: BookingServiceRow[] = [
      { barber_service_id: HAIRCUT_ID, booking_type: 'regular', duration_minutes: 30 },
      { barber_service_id: BEARD_ID, booking_type: 'regular', duration_minutes: 30 },
    ];

    const out = projectBookingServices(rows, HAIRCUT_ID, buildServiceMap());

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      id: HAIRCUT_ID,
      name: 'Haircut',
      durationMinutes: 30,
      bookingType: BookingTypeDto.REGULAR,
      startOffsetMinutes: 0,
    });
    expect(out[1]).toEqual({
      id: BEARD_ID,
      name: 'Beard',
      durationMinutes: 30,
      bookingType: BookingTypeDto.REGULAR,
      startOffsetMinutes: 30,
    });
  });

  it('handles three services with mixed booking types', () => {
    const rows: BookingServiceRow[] = [
      { barber_service_id: HAIRCUT_ID, booking_type: 'regular', duration_minutes: 30 },
      { barber_service_id: BEARD_ID, booking_type: 'after_hours', duration_minutes: 30 },
      { barber_service_id: LINEUP_ID, booking_type: 'regular', duration_minutes: 30 },
    ];

    const out = projectBookingServices(rows, HAIRCUT_ID, buildServiceMap());

    expect(out.map((s) => s.startOffsetMinutes)).toEqual([0, 30, 60]);
    expect(out[1].bookingType).toBe(BookingTypeDto.AFTER_HOURS);
    expect(out[2].name).toBe('Line Up');
    // durationMinutes surfaces the SERVICE's nominal duration, not the slot share
    expect(out[2].durationMinutes).toBe(15);
  });

  it('falls back to a single legacy entry when booking_services rows are absent', () => {
    const out = projectBookingServices([], HAIRCUT_ID, buildServiceMap());

    expect(out).toEqual([
      {
        id: HAIRCUT_ID,
        name: 'Haircut',
        durationMinutes: 30,
        bookingType: BookingTypeDto.REGULAR,
        startOffsetMinutes: 0,
      },
    ]);
  });

  it('returns an empty array when no rows AND no legacy FK', () => {
    expect(projectBookingServices([], null, buildServiceMap())).toEqual([]);
  });

  it('uses placeholder name + slot share duration when service metadata is missing', () => {
    const rows: BookingServiceRow[] = [
      { barber_service_id: 'ghost', booking_type: 'regular', duration_minutes: 30 },
    ];
    const out = projectBookingServices(rows, null, new Map());
    expect(out[0]).toEqual({
      id: 'ghost',
      name: 'Service',
      durationMinutes: 30,
      bookingType: BookingTypeDto.REGULAR,
      startOffsetMinutes: 0,
    });
  });
});
