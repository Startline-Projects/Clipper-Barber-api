import { NoShowsService, UNRESOLVED_STATUSES } from './no-shows.service';
import { NoShowStatusDto } from './dto/no-show.dto';

describe('NoShowsService.sortByBucket', () => {
  // Build the service without DI — we only exercise the pure sort helper.
  const svc = new NoShowsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );

  function row(id: string, status: NoShowStatusDto, createdAt: string) {
    return {
      id,
      booking_id: 'b' + id,
      client_id: 'c',
      barber_id: 'b',
      amount_usd: 10,
      currency: 'usd',
      reason: null,
      status,
      stripe_payment_intent_id: null,
      resolved_at: null,
      created_at: createdAt,
    };
  }

  it('puts unresolved/failed first (oldest first) and resolved last (newest first)', () => {
    const sorted = svc.sortByBucket([
      row('a', NoShowStatusDto.PAID, '2026-01-05'),
      row('b', NoShowStatusDto.UNRESOLVED, '2026-01-03'),
      row('c', NoShowStatusDto.PAID, '2026-01-01'),
      row('d', NoShowStatusDto.FAILED, '2026-01-02'),
      row('e', NoShowStatusDto.UNRESOLVED, '2026-01-04'),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['d', 'b', 'e', 'a', 'c']);
  });

  it('unresolved bucket includes both unresolved and failed', () => {
    expect((UNRESOLVED_STATUSES as readonly string[]).includes('unresolved')).toBe(true);
    expect((UNRESOLVED_STATUSES as readonly string[]).includes('failed')).toBe(true);
    expect((UNRESOLVED_STATUSES as readonly string[]).includes('paid')).toBe(false);
    expect((UNRESOLVED_STATUSES as readonly string[]).includes('refunded')).toBe(false);
  });
});
