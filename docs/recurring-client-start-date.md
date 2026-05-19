# Recurring booking — client-side `startDate`

Lets a **client** anchor a recurring booking to a future date instead of always
starting from the next matching day-of-week relative to barber acceptance. The
canonical use case: the upcoming Tuesday is already booked, so the client wants
the series to start from the Tuesday *after* that one.

The barber-initiated arrangement flow already supported `startDate` via
`CreateRecurringArrangementDto`. This change brings the **client-initiated**
flow (`/client/recurring-bookings` POST) to feature parity.

---

## API surface

### 1. `POST /client/recurring-bookings`

New optional field on `CreateRecurringBookingDto`:

```ts
startDate?: string; // YYYY-MM-DD, today-or-future in barber timezone
```

- Omitted → behavior is unchanged. `window_start_date` is set when the barber
  accepts and the generator snaps to the next matching DOW from that day.
- Provided → must be today-or-future in the barber's timezone. The request is
  rejected with `400 BadRequest` (`"startDate must be today or in the future."`)
  otherwise.
- The date is persisted to `recurring_bookings.window_start_date` immediately,
  even while the row is `pending_barber_approval`. When the barber accepts, the
  existing value is preserved (the accept step no longer overwrites it with
  `today` unconditionally).
- If, by the time the barber finally accepts, the pre-set date is in the past
  (e.g. the offer aged), the accept step falls back to `today` so generation
  never anchors in the past.

### 2. `GET /client/barbers/:barberId/recurring-slots` and `GET /barber/recurring-slots`

New optional query field on `GetRecurringSlotsQueryDto`:

```ts
startDate?: string; // YYYY-MM-DD
```

When set, slot availability is computed against one-off bookings on matching
days **from `startDate` forward** (clamped to today minimum), inside the same
60-day window. Without this, the slot is shown `available: false` as long as
any single Tuesday inside the next 60 days collides — which is exactly the
case the new feature needs to side-step.

`fetchRecurringBlockedSlotTimes` (collisions against *other* recurring
subscriptions) is independent of date and is intentionally unchanged: a
recurring slot blocks the slot every week, so `startDate` cannot route around
it.

---

## Files changed

| File | Change |
|------|--------|
| `src/modules/bookings/recurring/dto/create-recurring-booking.dto.ts` | Added optional `startDate` (ISO date). |
| `src/modules/bookings/recurring/dto/get-recurring-slots-query.dto.ts` | Added optional `startDate` (ISO date). |
| `src/modules/bookings/recurring/recurring.controller.ts` | Forwarded `query.startDate` to `getRecurringSlots` in both the client and barber controllers. |
| `src/modules/bookings/recurring/recurring.service.ts` | <ul><li>`getRecurringSlots` now accepts `startDate?`; clamps to today and threads to `fetchOneOffBlockedSlotMs`.</li><li>`fetchOneOffBlockedSlotMs` takes a required `startLocalDate` (caller decides).</li><li>`createRecurringBooking` forwards `dto.startDate` to internal as `requestedStartDate`.</li><li>`createRecurringInternal` validates `requestedStartDate ≥ today` (barber tz) and persists it on `window_start_date` regardless of `autoAccept`.</li><li>`acceptRecurringBooking` keeps a pre-set future `window_start_date`; only falls back to `today` if missing or already past. Rollback restores the original value instead of nulling.</li></ul> |

No schema migration — `recurring_bookings.window_start_date` was already
nullable. We are reusing it as "client's chosen anchor for pending rows."

---

## How it flows end-to-end

Example: today is **Sun 2026-05-17** (barber tz). Client wants a weekly
Tuesday slot, but **Tue 2026-05-19** is fully booked.

1. **Slot lookup**
   ```
   GET /client/barbers/:barberId/recurring-slots
       ?serviceIds=...&dayOfWeek=2&startDate=2026-05-26
   ```
   The 14:00 slot is no longer blacklisted by the 2026-05-19 conflict — only
   Tuesdays from 2026-05-26 onward are considered.

2. **Create**
   ```
   POST /client/recurring-bookings
   { ..., dayOfWeek: 2, slotTime: "14:00", frequency: "weekly",
     startDate: "2026-05-26" }
   ```
   The row is inserted with `status='pending_barber_approval'` and
   `window_start_date='2026-05-26'`.

3. **Barber accepts**

   `acceptRecurringBooking` sees `window_start_date='2026-05-26'`, leaves it
   alone, and runs the generator. The generator's
   `firstMatchingDowOnOrAfter` snaps to the first Tuesday on or after
   2026-05-26 → **Tue 2026-05-26** → and steps weekly from there. The booked
   2026-05-19 is never a candidate.

---

## Approach / design notes

- **Pre-setting `window_start_date` on pending rows.** The alternative (a
  separate `requested_start_date` column) would require a migration and a
  rule for which column wins at accept time. `window_start_date` was already
  nullable and unused for pending rows, so we repurposed it: pending means
  "the client's requested anchor," active means "the anchor the generator
  uses." The accept step is the only consumer that previously wrote it, and
  it now respects an existing value.

- **Validation is in `createRecurringInternal`, not the DTO.** "Today or
  future" depends on the barber's timezone, which the DTO layer can't see.
  class-validator only checks ISO shape; the temporal bound is a service
  concern (same pattern used by the arrangement service, see
  `recurring-arrangements.service.ts` ~line 131).

- **`getRecurringSlots` clamps `startDate` to today.** A past `startDate`
  query is silently treated as today rather than rejected — the endpoint is
  a read, the caller likely just hasn't refreshed their state, and falling
  back to today gives the same answer the no-`startDate` call would give.
  The strict bound applies only when the client commits via `POST`.

- **Past pre-set dates at accept time fall back to today.** A pending offer
  can sit for days. If the client picked Tue 2026-05-26 and the barber
  doesn't accept until 2026-06-05, anchoring to 2026-05-26 would have the
  generator try to materialize past Tuesdays (which the generator already
  skips per-occurrence, but the anchor itself being in the past is
  confusing). Falling back to today on accept keeps the semantics clear.

- **Rollback restores the original `window_start_date`.** Previously the
  accept-then-generate rollback nulled it. With this change, nulling would
  destroy the client's `startDate` intent on the retry. We snapshot the
  pre-accept value and write it back.

- **Out of scope.** The barber-initiated client-recurring path
  (`createRecurringByBarber`) does **not** expose `startDate` on its DTO yet
  — that path is documented as "auto-accepted, generates immediately." If
  product wants barber-on-behalf-of-client to choose a start date, mirror
  the change on `CreateBarberRecurringBookingDto` and thread it through
  `createRecurringByBarber` → `createRecurringInternal` (already accepts
  `requestedStartDate`).

- **Renewals.** `renewRecurringBooking` copies the original settings; it
  does not inherit a past `window_start_date`. Renewals continue to anchor
  at the renewal acceptance date. Adjusting renewals is a separate
  decision.

---

## Test plan

Backend:

- `POST /client/recurring-bookings` with `startDate` in the past → 400.
- `POST /client/recurring-bookings` with `startDate = tomorrow` → row
  persists with `window_start_date = tomorrow` and `status =
  pending_barber_approval`.
- Barber accept on the row above → `window_start_date` unchanged; first
  generated booking is the next matching DOW on or after `tomorrow`.
- Barber accept on a row with no `startDate` → `window_start_date = today`
  (unchanged legacy behavior).
- Generator failure on accept → row rolls back to pending; `window_start_date`
  is the pre-accept value (the client's `startDate` if set, else null).
- `GET .../recurring-slots?dayOfWeek=2&startDate=<future>` returns a slot as
  `available: true` even when the immediate next Tuesday at that time is
  one-off-booked.
- `GET .../recurring-slots` with no `startDate` returns the same response as
  before this change (no regression on the default path).
