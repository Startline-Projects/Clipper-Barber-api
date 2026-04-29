import { NotFoundException } from '@nestjs/common';
import { BarberClientsService } from './barber-clients.service';
import {
  BarberClientsOrderDto,
  BarberClientsSortDto,
} from './dto/list-barber-clients-query.dto';

// Unit tests mock the Supabase client and verify the wiring done in the
// service: parameter forwarding to the RPCs, response shaping, 404 mapping,
// derived fields (averageSpendUsd, isGuest, active). The SQL-level business
// rules (totalVisits = completed only, totalSpend filtering, search across
// name/email, sortBy variants, hasUpcoming filter, no-show inclusion) live
// inside get_barber_clients / get_barber_client_detail and are exercised
// by the integration test against a real Postgres in CI (out of scope here).

const BARBER_ID = '11111111-1111-1111-1111-111111111111';
const CLIENT_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_CLIENT_ID = '33333333-3333-3333-3333-333333333333';

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

interface FromQuery {
  table: string;
  filters: { column: string; op: string; value: unknown }[];
  orderBy: { column: string; ascending: boolean }[];
  rangeArgs: { from: number; to: number } | null;
  isHead: boolean;
  countMode: 'exact' | null;
  resolvedData: unknown;
  resolvedCount: number | null;
}

class FakeSupabase {
  public rpcCalls: RpcCall[] = [];
  public rpcResults: { data: unknown; error: unknown }[] = [];
  public fromCalls: FromQuery[] = [];
  public tableResponses: Record<string, { data: unknown; count?: number }[]> = {};

  rpc(fn: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ fn, args });
    const result = this.rpcResults.shift() ?? { data: null, error: null };
    return Promise.resolve(result);
  }

  from(table: string) {
    const queue = this.tableResponses[table] ?? [];
    const next = queue.shift() ?? { data: [] };
    const query: FromQuery = {
      table,
      filters: [],
      orderBy: [],
      rangeArgs: null,
      isHead: false,
      countMode: null,
      resolvedData: next.data,
      resolvedCount: next.count ?? null,
    };
    this.fromCalls.push(query);

    const resolveTerminal = () => {
      if (query.isHead) {
        return { data: null, count: query.resolvedCount, error: null };
      }
      return { data: query.resolvedData, error: null };
    };

    const builder = {
      select: (_cols: string, opts?: { head?: boolean; count?: 'exact' }) => {
        if (opts?.count === 'exact') query.countMode = 'exact';
        if (opts?.head) query.isHead = true;
        return chain;
      },
      eq: (column: string, value: unknown) => {
        query.filters.push({ column, op: 'eq', value });
        return chain;
      },
      in: (column: string, value: unknown) => {
        query.filters.push({ column, op: 'in', value });
        return chain;
      },
      gte: (column: string, value: unknown) => {
        query.filters.push({ column, op: 'gte', value });
        return chain;
      },
      lt: (column: string, value: unknown) => {
        query.filters.push({ column, op: 'lt', value });
        return chain;
      },
      order: (column: string, opts: { ascending: boolean }) => {
        query.orderBy.push({ column, ascending: opts.ascending });
        return chain;
      },
      range: (from: number, to: number) => {
        query.rangeArgs = { from, to };
        return Promise.resolve(resolveTerminal());
      },
      then: (resolve: (v: ReturnType<typeof resolveTerminal>) => void) => {
        resolve(resolveTerminal());
      },
    };
    type Chain = typeof builder & PromiseLike<ReturnType<typeof resolveTerminal>>;
    const chain = builder as unknown as Chain;
    return chain;
  }
}

function makeService(): { service: BarberClientsService; fake: FakeSupabase } {
  const fake = new FakeSupabase();
  const service = new BarberClientsService({
    getClient: () => fake,
  } as unknown as ConstructorParameters<typeof BarberClientsService>[0]);
  return { service, fake };
}

describe('BarberClientsService', () => {
  describe('listClients', () => {
    it('forwards search, sortBy, order, page, hasUpcoming to the RPC and shapes the response', async () => {
      const { service, fake } = makeService();
      fake.rpcResults.push({
        data: {
          total: 2,
          items: [
            {
              clientId: CLIENT_ID,
              name: 'Ahmed Mostafa',
              profilePhotoUrl: null,
              email: 'ahmed@example.com',
              totalVisits: 12,
              totalSpendUsd: 480.5,
              firstVisitAt: '2024-03-12T10:00:00Z',
              lastVisitAt: '2026-04-20T15:00:00Z',
              nextBookingAt: '2026-05-04T15:00:00Z',
              hasUpcoming: true,
            },
            {
              clientId: OTHER_CLIENT_ID,
              name: 'Sara Ali',
              profilePhotoUrl: 'https://example.com/p.jpg',
              email: 'sara@example.com',
              totalVisits: 1,
              totalSpendUsd: 25,
              firstVisitAt: '2026-02-01T10:00:00Z',
              lastVisitAt: '2026-02-01T10:00:00Z',
              nextBookingAt: null,
              hasUpcoming: false,
            },
          ],
        },
        error: null,
      });

      const result = await service.listClients(BARBER_ID, {
        search: 'ah',
        sortBy: BarberClientsSortDto.TOTAL_VISITS,
        order: BarberClientsOrderDto.ASC,
        page: 2,
        limit: 50,
        hasUpcoming: true,
      });

      expect(fake.rpcCalls).toHaveLength(1);
      expect(fake.rpcCalls[0]).toEqual({
        fn: 'get_barber_clients',
        args: {
          p_barber_id: BARBER_ID,
          p_search: 'ah',
          p_sort_by: 'totalVisits',
          p_order: 'asc',
          p_offset: 50, // (page - 1) * limit
          p_limit: 50,
          p_has_upcoming: true,
        },
      });

      expect(result.clients).toHaveLength(2);
      expect(result.clients[0]).toMatchObject({
        clientId: CLIENT_ID,
        name: 'Ahmed Mostafa',
        email: 'ahmed@example.com',
        totalVisits: 12,
        totalSpendUsd: 480.5,
        hasUpcoming: true,
        isGuest: false,
      });
      expect(result.pagination).toEqual({
        currentPage: 2,
        totalPages: 1,
        limit: 50,
        hasNextPage: false,
        totalClients: 2,
      });
    });

    it('applies defaults when no params supplied (sort=lastVisit desc, page=1, limit=20, hasUpcoming=false)', async () => {
      const { service, fake } = makeService();
      fake.rpcResults.push({ data: { total: 0, items: [] }, error: null });

      const result = await service.listClients(BARBER_ID, {});

      expect(fake.rpcCalls[0].args).toEqual({
        p_barber_id: BARBER_ID,
        p_search: null,
        p_sort_by: 'lastVisit',
        p_order: 'desc',
        p_offset: 0,
        p_limit: 20,
        p_has_upcoming: false,
      });
      expect(result.clients).toHaveLength(0);
      expect(result.pagination.totalClients).toBe(0);
      expect(result.pagination.totalPages).toBe(1); // never less than 1
    });

    it('caps limit at 100', async () => {
      const { service, fake } = makeService();
      fake.rpcResults.push({ data: { total: 0, items: [] }, error: null });

      await service.listClients(BARBER_ID, { limit: 999 });

      expect(fake.rpcCalls[0].args.p_limit).toBe(100);
    });

    it('always returns isGuest=false (no guest support exists)', async () => {
      const { service, fake } = makeService();
      fake.rpcResults.push({
        data: {
          total: 1,
          items: [
            {
              clientId: CLIENT_ID,
              name: 'X',
              profilePhotoUrl: null,
              email: null,
              totalVisits: 0,
              totalSpendUsd: 0,
              firstVisitAt: null,
              lastVisitAt: null,
              nextBookingAt: null,
              hasUpcoming: false,
            },
          ],
        },
        error: null,
      });

      const result = await service.listClients(BARBER_ID, {});
      expect(result.clients[0].isGuest).toBe(false);
    });
  });

  describe('getClientDetail', () => {
    it('returns 404 when the RPC returns null (no relationship — never leak existence)', async () => {
      const { service, fake } = makeService();
      fake.rpcResults.push({ data: null, error: null });

      await expect(service.getClientDetail(BARBER_ID, CLIENT_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('hydrates upcoming/past bookings + recurring series and computes averageSpendUsd', async () => {
      const { service, fake } = makeService();

      fake.rpcResults.push({
        data: {
          profile: {
            id: CLIENT_ID,
            name: 'Ahmed Mostafa',
            profilePhotoUrl: null,
            email: 'ahmed@example.com',
            createdAt: '2024-03-12T10:00:00Z',
          },
          totalVisits: 4,
          totalSpendUsd: 200,
          firstVisitAt: '2024-03-12T10:00:00Z',
          lastVisitAt: '2026-04-20T15:00:00Z',
          noShowCount: 1,
          cancellationCount: 2,
          nextBookingAt: '2026-05-04T15:00:00Z',
          favouriteService: { id: 'svc-1', name: 'Skin Fade' },
        },
        error: null,
      });

      // Order matches the parallel Promise.all: upcoming bookings, past
      // count head query, past data, recurring series, then the lookups
      // performed by hydrateBookings / fetchRecurringSeries.
      const upcomingRow = {
        id: 'b-up',
        scheduled_at: '2026-05-04T15:00:00Z',
        status: 'confirmed',
        booking_type: 'regular',
        duration_minutes: 30,
        price_usd: 50,
        recurring_booking_id: 'rec-1',
        cancelled_at: null,
        cancelled_by: null,
      };
      const pastRow = {
        id: 'b-past',
        scheduled_at: '2026-04-20T15:00:00Z',
        status: 'completed',
        booking_type: 'regular',
        duration_minutes: 30,
        price_usd: 50,
        recurring_booking_id: null,
        cancelled_at: null,
        cancelled_by: null,
      };
      const recurringRow = {
        id: 'rec-1',
        day_of_week: 1,
        slot_time: '15:00:00',
        frequency: 'weekly',
        status: 'active',
        price_usd: 50,
        barber_service_id: 'svc-1',
        created_at: '2025-01-01T14:00:00Z',
        barber_accepted_at: '2025-01-01T14:00:00Z',
        cancelled_at: null,
      };

      fake.tableResponses['bookings'] = [
        // 1) fetchUpcomingBookings select (resolves via thenable)
        { data: [upcomingRow] },
        // 2) fetchPastBookings count head query
        { data: null, count: 1 },
        // 3) fetchPastBookings select (resolves via .range)
        { data: [pastRow] },
        // 4) fetchNextRecurringOccurrences (only fires if recurring rows exist)
        { data: [{ recurring_booking_id: 'rec-1', scheduled_at: '2026-05-11T15:00:00Z' }] },
      ];
      fake.tableResponses['booking_services'] = [
        // hydrateBookings(upcoming)
        {
          data: [
            {
              booking_id: 'b-up',
              barber_service_id: 'svc-1',
              booking_type: 'regular',
              duration_minutes: 30,
              price_usd: 50,
              sort_order: 0,
            },
          ],
        },
        // hydrateBookings(past)
        {
          data: [
            {
              booking_id: 'b-past',
              barber_service_id: 'svc-1',
              booking_type: 'regular',
              duration_minutes: 30,
              price_usd: 50,
              sort_order: 0,
            },
          ],
        },
      ];
      fake.tableResponses['barber_services'] = [
        // fetchBarberServices for upcoming hydrate
        { data: [{ id: 'svc-1', name: 'Skin Fade', duration_minutes: 30 }] },
        // fetchBarberServices for past hydrate
        { data: [{ id: 'svc-1', name: 'Skin Fade', duration_minutes: 30 }] },
        // fetchBarberServices for recurring series hydrate
        { data: [{ id: 'svc-1', name: 'Skin Fade', duration_minutes: 30 }] },
      ];
      fake.tableResponses['recurring_bookings'] = [{ data: [recurringRow] }];

      const result = await service.getClientDetail(BARBER_ID, CLIENT_ID);

      expect(result.client).toEqual({
        id: CLIENT_ID,
        name: 'Ahmed Mostafa',
        profilePhotoUrl: null,
        email: 'ahmed@example.com',
        createdAt: '2024-03-12T10:00:00.000Z',
        isGuest: false,
      });
      expect(result.stats).toEqual({
        totalVisits: 4,
        totalSpendUsd: 200,
        averageSpendUsd: 50,
        firstVisitAt: '2024-03-12T10:00:00.000Z',
        lastVisitAt: '2026-04-20T15:00:00.000Z',
        noShowCount: 1,
        cancellationCount: 2,
        favouriteService: { id: 'svc-1', name: 'Skin Fade' },
      });
      expect(result.upcomingBookings).toHaveLength(1);
      expect(result.upcomingBookings[0]).toMatchObject({
        id: 'b-up',
        isRecurring: true,
        recurringBookingId: 'rec-1',
        services: [
          {
            id: 'svc-1',
            name: 'Skin Fade',
            durationMinutes: 30,
            priceUsd: 50,
          },
        ],
      });
      expect(result.pastBookings.items).toHaveLength(1);
      expect(result.pastBookings.pagination.totalBookings).toBe(1);
      expect(result.recurringSeries).toHaveLength(1);
      expect(result.recurringSeries[0]).toMatchObject({
        id: 'rec-1',
        dayOfWeek: 1,
        slotTime: '15:00',
        frequency: 'weekly',
        status: 'active',
        active: true,
        priceUsd: 50,
        nextOccurrenceAt: '2026-05-11T15:00:00.000Z',
        cancelledAt: null,
      });
    });

    it('averageSpendUsd is 0 when totalVisits is 0', async () => {
      const { service, fake } = makeService();
      fake.rpcResults.push({
        data: {
          profile: {
            id: CLIENT_ID,
            name: 'Ahmed',
            profilePhotoUrl: null,
            email: null,
            createdAt: null,
          },
          totalVisits: 0,
          totalSpendUsd: 0,
          firstVisitAt: null,
          lastVisitAt: null,
          noShowCount: 0,
          cancellationCount: 0,
          nextBookingAt: null,
          favouriteService: null,
        },
        error: null,
      });

      // Only no-show or cancelled history → no upcoming/past to hydrate.
      fake.tableResponses['bookings'] = [
        { data: [] }, // upcoming
        { data: null, count: 0 }, // past count
        { data: [] }, // past select
      ];
      fake.tableResponses['recurring_bookings'] = [{ data: [] }];

      const result = await service.getClientDetail(BARBER_ID, CLIENT_ID);
      expect(result.stats.averageSpendUsd).toBe(0);
      expect(result.stats.favouriteService).toBeNull();
      expect(result.upcomingBookings).toHaveLength(0);
      expect(result.pastBookings.items).toHaveLength(0);
      expect(result.recurringSeries).toHaveLength(0);
    });

    it('marks recurringSeries.active=false for cancelled status', async () => {
      const { service, fake } = makeService();
      fake.rpcResults.push({
        data: {
          profile: {
            id: CLIENT_ID,
            name: 'Ahmed',
            profilePhotoUrl: null,
            email: null,
            createdAt: null,
          },
          totalVisits: 1,
          totalSpendUsd: 50,
          firstVisitAt: '2026-01-01T00:00:00Z',
          lastVisitAt: '2026-01-01T00:00:00Z',
          noShowCount: 0,
          cancellationCount: 0,
          nextBookingAt: null,
          favouriteService: null,
        },
        error: null,
      });

      fake.tableResponses['bookings'] = [
        { data: [] }, // upcoming
        { data: null, count: 0 }, // past count
        { data: [] }, // past select
      ];
      fake.tableResponses['recurring_bookings'] = [
        {
          data: [
            {
              id: 'rec-cancelled',
              day_of_week: 1,
              slot_time: '15:00:00',
              frequency: 'weekly',
              status: 'cancelled',
              price_usd: 50,
              barber_service_id: 'svc-1',
              created_at: '2025-01-01T14:00:00Z',
              barber_accepted_at: null,
              cancelled_at: '2026-02-01T00:00:00Z',
            },
          ],
        },
      ];
      fake.tableResponses['barber_services'] = [
        { data: [{ id: 'svc-1', name: 'Skin Fade', duration_minutes: 30 }] },
      ];

      const result = await service.getClientDetail(BARBER_ID, CLIENT_ID);
      expect(result.recurringSeries[0].active).toBe(false);
      expect(result.recurringSeries[0].status).toBe('cancelled');
      expect(result.recurringSeries[0].cancelledAt).toBe('2026-02-01T00:00:00.000Z');
      // No outstanding pending/confirmed occurrences → no extra fetch
      expect(result.recurringSeries[0].nextOccurrenceAt).toBeNull();
    });
  });
});
