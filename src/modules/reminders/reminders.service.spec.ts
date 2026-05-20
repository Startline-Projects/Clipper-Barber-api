import { RemindersService } from './reminders.service';

// ── Minimal fake Supabase client ────────────────────────────
// Supports the fluent subset RemindersService uses: from().select().eq()
// .in().gt().lt().order().maybeSingle()/await, .upsert(), .update().eq(),
// .rpc(), and auth.admin.getUserById().
interface FakeCtx {
  table: string;
  filters: Record<string, unknown>;
  terminal: 'single' | 'list';
}

interface FakeConfig {
  tables?: Record<string, (ctx: FakeCtx) => { data: unknown; error: unknown }>;
  rpc?: Record<string, unknown[]>;
  users?: Record<string, { email: string | null } | undefined>;
}

function createFakeDb(config: FakeConfig) {
  const calls = {
    upserts: [] as Array<{ table: string; payload: unknown }>,
    updates: [] as Array<{ table: string; patch: Record<string, unknown>; filters: Record<string, unknown> }>,
    rpc: [] as Array<{ name: string; args: unknown }>,
  };

  const resolveSelect = (ctx: FakeCtx) => {
    const fn = config.tables?.[ctx.table];
    if (fn) return fn(ctx);
    return { data: ctx.terminal === 'single' ? null : [], error: null };
  };

  const api = {
    from(table: string) {
      const ctx: FakeCtx = { table, filters: {}, terminal: 'list' };
      const selectBuilder = {
        select: () => selectBuilder,
        eq: (k: string, v: unknown) => {
          ctx.filters[k] = v;
          return selectBuilder;
        },
        in: () => selectBuilder,
        gt: () => selectBuilder,
        lt: () => selectBuilder,
        order: () => selectBuilder,
        maybeSingle: () => {
          ctx.terminal = 'single';
          return Promise.resolve(resolveSelect(ctx));
        },
        single: () => {
          ctx.terminal = 'single';
          return Promise.resolve(resolveSelect(ctx));
        },
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
          ctx.terminal = 'list';
          return Promise.resolve(resolveSelect(ctx)).then(onF, onR);
        },
      };

      const makeUpdateBuilder = (patch: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {};
        const updateBuilder = {
          eq: (k: string, v: unknown) => {
            filters[k] = v;
            return updateBuilder;
          },
          then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
            calls.updates.push({ table, patch, filters });
            return Promise.resolve({ error: null }).then(onF, onR);
          },
        };
        return updateBuilder;
      };

      return {
        ...selectBuilder,
        upsert: (payload: unknown) => {
          calls.upserts.push({ table, payload });
          return Promise.resolve({ error: null });
        },
        update: (patch: Record<string, unknown>) => makeUpdateBuilder(patch),
      };
    },
    rpc: (name: string, args: unknown) => {
      calls.rpc.push({ name, args });
      return Promise.resolve({ data: config.rpc?.[name] ?? [], error: null });
    },
    auth: {
      admin: {
        getUserById: (id: string) => {
          const user = config.users?.[id] ?? null;
          return Promise.resolve({ data: { user }, error: null });
        },
      },
    },
  };

  return { api, calls };
}

function buildService(config: FakeConfig, mail?: { send: jest.Mock }) {
  const { api, calls } = createFakeDb(config);
  const supabaseService = { getClient: () => api } as never;
  const mailService = (mail ?? { send: jest.fn().mockResolvedValue({ ok: true, messageId: 'msg_1', error: null }) }) as never;
  const configService = { get: () => undefined } as never;
  const service = new RemindersService(supabaseService, mailService, configService);
  return { service, calls, mail: mailService as unknown as { send: jest.Mock } };
}

const FUTURE = new Date(Date.now() + 3 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

function barberRow() {
  return {
    full_name: 'Sam Barber',
    shop_name: 'Sharp Cuts',
    street_address: '1 Main St',
    city: 'NYC',
    state: 'NY',
    zip_code: '10001',
    timezone: 'America/New_York',
  };
}

describe('RemindersService', () => {
  // ────────────────────────────────────────────────────────────
  // Settings
  // ────────────────────────────────────────────────────────────
  describe('getSettings', () => {
    it('returns both groups disabled when no rows exist', async () => {
      const { service } = buildService({ tables: { barber_reminder_settings: () => ({ data: [], error: null }) } });
      const settings = await service.getSettings('barber-1');
      expect(settings.client.enabled).toBe(false);
      expect(settings.self.enabled).toBe(false);
    });

    it('maps a stored client group', async () => {
      const { service } = buildService({
        tables: {
          barber_reminder_settings: () => ({
            data: [
              { target: 'client', enabled: true, reminder_type: 'hours_before', offset_hours: 2, offset_minutes: null },
            ],
            error: null,
          }),
        },
      });
      const settings = await service.getSettings('barber-1');
      expect(settings.client).toEqual({
        enabled: true,
        reminderType: 'hours_before',
        offsetHours: 2,
        offsetMinutes: null,
      });
      expect(settings.self.enabled).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Precompute on booking create
  // ────────────────────────────────────────────────────────────
  describe('onBookingCreated', () => {
    it('schedules a pending client reminder and cancels nothing when self is off', async () => {
      const { service, calls } = buildService({
        users: { 'client-1': { email: 'client@example.com' } },
        tables: {
          bookings: () => ({
            data: { id: 'bk-1', barber_id: 'barber-1', client_id: 'client-1', scheduled_at: FUTURE, status: 'confirmed', price_usd: 30, duration_minutes: 45 },
            error: null,
          }),
          barber_reminder_settings: () => ({
            data: [
              { target: 'client', enabled: true, reminder_type: 'hours_before', offset_hours: 2, offset_minutes: null },
              { target: 'self', enabled: false, reminder_type: 'hours_before', offset_hours: 1, offset_minutes: null },
            ],
            error: null,
          }),
          barbers: () => ({ data: barberRow(), error: null }),
          scheduled_reminders: () => ({ data: null, error: null }), // no existing row
        },
      });

      await service.onBookingCreated('bk-1');

      expect(calls.upserts).toHaveLength(1);
      const payload = calls.upserts[0].payload as Record<string, unknown>;
      expect(payload.recipient_type).toBe('client');
      expect(payload.recipient_email).toBe('client@example.com');
      expect(payload.status).toBe('pending');
    });

    it('marks the reminder skipped when send_at is already past', async () => {
      const { service, calls } = buildService({
        users: { 'client-1': { email: 'client@example.com' } },
        tables: {
          bookings: () => ({
            // appointment is in 1h but reminder is 2h before → already past
            data: { id: 'bk-1', barber_id: 'barber-1', client_id: 'client-1', scheduled_at: new Date(Date.now() + 3_600_000).toISOString(), status: 'confirmed', price_usd: 30, duration_minutes: 45 },
            error: null,
          }),
          barber_reminder_settings: () => ({
            data: [{ target: 'client', enabled: true, reminder_type: 'hours_before', offset_hours: 2, offset_minutes: null }],
            error: null,
          }),
          barbers: () => ({ data: barberRow(), error: null }),
          scheduled_reminders: () => ({ data: null, error: null }),
        },
      });

      await service.onBookingCreated('bk-1');
      const payload = calls.upserts[0].payload as Record<string, unknown>;
      expect(payload.status).toBe('skipped');
    });

    it('does not re-send: leaves an already-sent reminder untouched', async () => {
      const { service, calls } = buildService({
        users: { 'client-1': { email: 'client@example.com' } },
        tables: {
          bookings: () => ({
            data: { id: 'bk-1', barber_id: 'barber-1', client_id: 'client-1', scheduled_at: FUTURE, status: 'confirmed', price_usd: 30, duration_minutes: 45 },
            error: null,
          }),
          barber_reminder_settings: () => ({
            data: [{ target: 'client', enabled: true, reminder_type: 'hours_before', offset_hours: 2, offset_minutes: null }],
            error: null,
          }),
          barbers: () => ({ data: barberRow(), error: null }),
          scheduled_reminders: () => ({ data: { id: 'r-existing', status: 'sent' }, error: null }),
        },
      });

      await service.onBookingCreated('bk-1');
      expect(calls.upserts).toHaveLength(0);
      expect(calls.updates).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Dispatch
  // ────────────────────────────────────────────────────────────
  describe('dispatchDueReminders', () => {
    function dispatchConfig(overrides: Partial<FakeConfig> = {}): FakeConfig {
      return {
        rpc: {
          claim_due_reminders: [
            { id: 'r-1', booking_id: 'bk-1', recipient_type: 'client', recipient_email: 'client@example.com', send_at: PAST, attempts: 1 },
          ],
        },
        tables: {
          bookings: () => ({
            data: { id: 'bk-1', barber_id: 'barber-1', client_id: 'client-1', scheduled_at: FUTURE, status: 'confirmed', price_usd: 30, duration_minutes: 45 },
            error: null,
          }),
          barbers: () => ({ data: barberRow(), error: null }),
          clients: () => ({ data: { name: 'Joe Client' }, error: null }),
          booking_services: () => ({ data: [{ barber_service_id: 's-1', sort_order: 0 }], error: null }),
          barber_services: () => ({ data: [{ id: 's-1', name: 'Haircut' }], error: null }),
        },
        ...overrides,
      };
    }

    it('sends a due reminder and marks it sent with the resend message id', async () => {
      const mail = { send: jest.fn().mockResolvedValue({ ok: true, messageId: 'resend_123', error: null }) };
      const { service, calls } = buildService(dispatchConfig(), mail);

      await service.dispatchDueReminders();

      expect(mail.send).toHaveBeenCalledTimes(1);
      expect(calls.updates).toHaveLength(1);
      expect(calls.updates[0].patch).toMatchObject({ status: 'sent', resend_message_id: 'resend_123' });
    });

    it('skips when the appointment time has already passed', async () => {
      const mail = { send: jest.fn() };
      const { service, calls } = buildService(
        dispatchConfig({
          tables: {
            bookings: () => ({
              data: { id: 'bk-1', barber_id: 'barber-1', client_id: 'client-1', scheduled_at: PAST, status: 'confirmed', price_usd: 30, duration_minutes: 45 },
              error: null,
            }),
            barbers: () => ({ data: barberRow(), error: null }),
            clients: () => ({ data: { name: 'Joe' }, error: null }),
            booking_services: () => ({ data: [], error: null }),
            barber_services: () => ({ data: [], error: null }),
          },
        }),
        mail,
      );

      await service.dispatchDueReminders();
      expect(mail.send).not.toHaveBeenCalled();
      expect(calls.updates[0].patch.status).toBe('skipped');
    });

    it('retries (keeps pending) when send fails and attempts remain', async () => {
      const mail = { send: jest.fn().mockResolvedValue({ ok: false, messageId: null, error: 'boom' }) };
      const { service, calls } = buildService(dispatchConfig(), mail);

      await service.dispatchDueReminders();
      expect(calls.updates[0].patch).toMatchObject({ status: 'pending', error: 'boom' });
    });

    it('marks failed when send fails and attempts are exhausted', async () => {
      const mail = { send: jest.fn().mockResolvedValue({ ok: false, messageId: null, error: 'boom' }) };
      const { service, calls } = buildService(
        dispatchConfig({
          rpc: {
            claim_due_reminders: [
              { id: 'r-1', booking_id: 'bk-1', recipient_type: 'client', recipient_email: 'client@example.com', send_at: PAST, attempts: 3 },
            ],
          },
        }),
        mail,
      );

      await service.dispatchDueReminders();
      expect(calls.updates[0].patch).toMatchObject({ status: 'failed' });
    });

    it('skips a claimed row with no recipient email without loading the booking', async () => {
      const mail = { send: jest.fn() };
      const { service, calls } = buildService(
        dispatchConfig({
          rpc: {
            claim_due_reminders: [
              { id: 'r-1', booking_id: 'bk-1', recipient_type: 'client', recipient_email: '', send_at: PAST, attempts: 1 },
            ],
          },
        }),
        mail,
      );

      await service.dispatchDueReminders();
      expect(mail.send).not.toHaveBeenCalled();
      expect(calls.updates[0].patch).toMatchObject({ status: 'skipped' });
    });
  });
});
