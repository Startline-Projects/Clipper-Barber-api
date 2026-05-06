import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RecurringArrangementsService } from './recurring-arrangements.service';

// Focused unit tests on the state-machine guard. The transition matrix is
// the most behaviour-bearing piece of the service that does NOT need a
// full Supabase mock — exercise it directly.
//
// End-to-end coverage (DB inserts, conflict shape, notification dispatch,
// 404-on-cross-tenant) is exercised by the integration test against a
// real Postgres in CI; not duplicated here.

const svc = new RecurringArrangementsService(
  // SupabaseService is unused in these tests — assertCanTransition is pure.
  { getClient: () => null } as never,
  null as never,
  null as never,
);

type S = 'pending_client_approval' | 'active' | 'rejected' | 'cancelled' | 'ended';

function row(status: S, initiator: 'client' | 'barber' = 'barber'): never {
  return { status, initiator } as never;
}

function call(r: never, target: S): unknown {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return (svc as unknown as { assertCanTransition: (r: never, t: S) => void }).assertCanTransition(
    r,
    target,
  );
}

describe('RecurringArrangementsService — state machine', () => {
  describe('pending_client_approval', () => {
    it('allows accept (active)', () => {
      expect(() => call(row('pending_client_approval'), 'active')).not.toThrow();
    });
    it('allows reject (rejected)', () => {
      expect(() => call(row('pending_client_approval'), 'rejected')).not.toThrow();
    });
    it('allows cancel (cancelled)', () => {
      expect(() => call(row('pending_client_approval'), 'cancelled')).not.toThrow();
    });
    it('blocks end', () => {
      expect(() => call(row('pending_client_approval'), 'ended')).toThrow(BadRequestException);
    });
  });

  describe('active', () => {
    it('allows end', () => {
      expect(() => call(row('active'), 'ended')).not.toThrow();
    });
    it('blocks accept (already active)', () => {
      expect(() => call(row('active'), 'active')).toThrow(BadRequestException);
    });
    it('blocks reject', () => {
      expect(() => call(row('active'), 'rejected')).toThrow(BadRequestException);
    });
    it('blocks cancel', () => {
      expect(() => call(row('active'), 'cancelled')).toThrow(BadRequestException);
    });
  });

  describe('terminal states', () => {
    it.each<S>(['rejected', 'cancelled', 'ended'])(
      '%s rejects every transition',
      (state) => {
        for (const target of ['pending_client_approval', 'active', 'rejected', 'cancelled', 'ended'] as S[]) {
          expect(() => call(row(state), target)).toThrow(BadRequestException);
        }
      },
    );
  });

  it('refuses to act on a client-initiated row even with a valid target', () => {
    expect(() => call(row('pending_client_approval', 'client'), 'active')).toThrow(
      NotFoundException,
    );
  });

  it('returns invalid_state_transition error code for blocked transitions', () => {
    try {
      call(row('rejected'), 'active');
      fail('should have thrown');
    } catch (err) {
      const response = (err as BadRequestException).getResponse() as {
        errorCode: string;
        currentState: string;
      };
      expect(response.errorCode).toBe('invalid_state_transition');
      expect(response.currentState).toBe('rejected');
    }
  });
});
