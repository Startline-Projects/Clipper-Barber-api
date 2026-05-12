# Multi-Service Booking — API & Schema Changes (2026-05-12)

## Background

A single booking can include up to 4 services (e.g. Haircut + Beard).
The DB has stored these correctly since the
`20260425000001_multi_service_bookings` migration:

- ONE row in `bookings` per booking, with `duration_minutes` = total
  combined block (sum of slot shares).
- N rows in `booking_services`, one per service, ordered by `sort_order`.
- Overlap enforcement (`bookings_no_overlap_trigger` + `assertNoOverlap`)
  evaluates the full combined block.

The bug was on the **serialization side**: barber-facing endpoints and the
client `upcoming bookings` endpoint emitted only the primary
`barber_service_id`, with `durationMinutes` = that single service's
nominal duration. Calendar UIs that compute `endAt = scheduledAt +
durationMinutes` rendered only the first sub-slot as occupied, leaving
the rest visually available even though the slot grid already blocked
them.

This document records the API & schema changes shipped to fix that.

---

## 1. Schema changes

### New migration

`api/supabase/migrations/20260512000001_barber_home_multi_service.sql`

Replaces `get_barber_home(uuid, text, timestamptz)`. Each pending and
schedule item in the RPC payload now carries:

- `services` — jsonb array aggregated from `booking_services`, sorted by
  `sort_order`:
  ```json
  [
    { "id": "...", "name": "Haircut", "durationMinutes": 30, "bookingType": "regular" },
    { "id": "...", "name": "Beard",   "durationMinutes": 30, "bookingType": "regular" }
  ]
  ```
- Schedule items additionally include `totalDurationMinutes` (= the
  `bookings.duration_minutes` snapshot — the full block length).
- The legacy single `service` object is retained for backwards
  compatibility, but on schedule items its `durationMinutes` is now the
  **total block** (`bookings.duration_minutes`), not the primary
  service's nominal duration. This makes unupgraded clients render the
  correct slot height even before they consume `services[]`.

No table schema changes were required — `bookings.duration_minutes` and
`booking_services` already carry everything the new payload needs.

---

## 2. API response changes

All changes are **additive**: new fields are added; existing fields stay
in place. The only semantic shift is that legacy
`service.durationMinutes` / `durationMinutes` fields now return the
**total combined block** instead of the primary service's nominal
duration. Clients that previously relied on this to compute an end time
get the right value automatically; clients that want the per-service
breakdown should switch to the new `services[]` array.

### 2.1 `GET /barber/bookings` (list)

`BarberBookingListItemDto`:

| Field | Before | After |
|---|---|---|
| `service` | `{ name, durationMinutes }` (primary, nominal) | `{ name, durationMinutes }` (primary name, **total block** duration) |
| `services` | _(absent)_ | **new** — `BarberBookingServiceItemDto[]` |
| `totalDurationMinutes` | _(absent)_ | **new** — total block in minutes |

`BarberBookingServiceItemDto`:
```ts
{
  id: string;                    // barber_service_id
  name: string;
  durationMinutes: number;       // service's NOMINAL duration (from barber_services)
  bookingType: 'regular' | 'after_hours' | 'day_off';
  startOffsetMinutes: number;    // minutes from block start
}
```

### 2.2 `GET /barber/bookings/:id` (detail)

`BarberBookingDetailDto`: same additions as list — adds `services[]`
and `totalDurationMinutes`; legacy `service.durationMinutes` is now the
total block.

### 2.3 `GET /barber/home`

`BarberHomeScheduleItemDto`:

| Field | Before | After |
|---|---|---|
| `service.durationMinutes` | primary service's nominal duration | **total block** duration (`bookings.duration_minutes`) |
| `services` | _(absent)_ | **new** — `BarberHomeBookingServiceItemDto[]` |
| `totalDurationMinutes` | _(absent)_ | **new** |

`BarberHomePendingItemDto`:

| Field | Before | After |
|---|---|---|
| `services` | _(absent)_ | **new** — `BarberHomeBookingServiceItemDto[]` |

`BarberHomeBookingServiceItemDto`:
```ts
{
  id: string;
  name: string;
  durationMinutes: number;       // service's nominal duration
  bookingType: 'regular' | 'after_hours' | 'day_off';
}
```

### 2.4 `GET /client/bookings/upcoming` (calendar)

`ClientUpcomingBookingDto`:

| Field | Before | After |
|---|---|---|
| `serviceName` | primary service's name | Joined display (`"Haircut + Beard"`) when multi-service; otherwise the single name |
| `durationMinutes` | primary service's nominal duration (with fallback) | **total block** duration |
| `services` | _(absent)_ | **new** — `ClientUpcomingBookingServiceDto[]` |
| `totalDurationMinutes` | _(absent)_ | **new** |

`ClientUpcomingBookingServiceDto`: same shape as
`BarberBookingServiceItemDto` (id, name, durationMinutes, bookingType,
startOffsetMinutes).

### 2.5 Endpoints unchanged

- `GET /client/bookings/:id` — already returned `services[]` with
  `startOffsetMinutes` and `totalDurationMinutes`.
- `POST /bookings/preview`, `POST /bookings/confirm` — already returned
  `services[]` and `totalDurationMinutes`.
- `GET /barbers/:id/availability` — the slot generator already expands
  multi-slot bookings across all grid positions they occupy; both
  blocking and overlap detection were already correct.

---

## 3. Behavioral guarantees

For a Haircut (30 min) + Beard (30 min) booking on a barber whose grid
is 30 min:

- **DB**: 1 row in `bookings` (`duration_minutes = 60`), 2 rows in
  `booking_services` (sort_order 0, 1; each `duration_minutes = 30`).
- **Availability**: both grid slots that the block covers are marked
  unavailable. New bookings cannot start at either position. The
  `bookings_no_overlap_trigger` rejects overlapping inserts atomically
  via `pg_advisory_xact_lock(barber_id)`.
- **Barber-facing UIs**: receive `services: [Haircut, Beard]` and
  `totalDurationMinutes: 60`. Calendar renders ONE 60-minute slot.
- **Client-facing UIs**: same — one slot, two services, total 60 min.

### Legacy data fallback

For bookings created before `booking_services` existed (i.e. zero rows
in the join table), the projection helper falls back to a single
synthetic entry built from `bookings.barber_service_id`. So old data
still serializes cleanly through every endpoint.

---

## 4. Affected files

### TypeScript

- `src/modules/bookings/util/booking-services-projection.ts` _(new)_ —
  shared pure helper `projectBookingServices(rows, legacyFK, serviceMap)`.
- `src/modules/bookings/util/booking-services-projection.spec.ts` _(new)_ —
  unit tests covering single-service, multi-service, legacy fallback,
  missing-metadata fallback.
- `src/modules/barbers/dto/barber-booking-list-item.dto.ts` — added
  `BarberBookingServiceItemDto`; new `services[]` + `totalDurationMinutes`.
- `src/modules/barbers/dto/barber-booking-detail.dto.ts` — same.
- `src/modules/barbers/barbers.service.ts` — batch-loads
  `booking_services` in `listBookings` + `getBookingDetail`.
- `src/modules/barbers/home/dto/barber-home-response.dto.ts` — added
  `BarberHomeBookingServiceItemDto`; `services[]` on pending and
  schedule items; `totalDurationMinutes` on schedule items.
- `src/modules/barbers/home/barber-home.service.ts` — RPC shape now
  carries `services` and `totalDurationMinutes`; new
  `shapeBookingServices` helper.
- `src/modules/bookings/dto/client-upcoming-booking.dto.ts` — added
  `ClientUpcomingBookingServiceDto`; new `services[]` +
  `totalDurationMinutes`; legacy `durationMinutes` semantics updated.
- `src/modules/bookings/bookings.service.ts` — batch-loads
  `booking_services` in `hydrateUpcomingBookings`.

### SQL

- `supabase/migrations/20260512000001_barber_home_multi_service.sql`
  _(new)_ — replaces `get_barber_home` to emit `services` + total
  duration.

---

## 5. Migration / deploy notes

1. Apply the new migration before deploying the API:
   `supabase db push` (or your environment's equivalent).
2. The function replacement is `CREATE OR REPLACE` — safe to apply
   live; existing callers continue to work mid-deploy.
3. No data backfill required. Pre-existing bookings without
   `booking_services` rows continue to serialize via the legacy fallback.
4. Mobile clients that depend on `service.durationMinutes` now receive
   the total block — verify calendar rendering after deploy. New
   clients should switch to `services[]` + `totalDurationMinutes`.

---

# Follow-up API Additions (2026-05-12)

Three small, independent capabilities shipped on top of the multi-service
rollout. All additive — no breaking changes.

## 6. Clear-all notifications

UX surfaces a single "Clear all" button on both the barber and client
notifications screens. Semantics: **mark every unread notification as
read** (non-destructive — rows stay in the DB and remain visible in
history; unread badge drops to 0). No new column required — the existing
`notifications.is_read` boolean is the source of truth.

### 6.1 `POST /barber/notifications/clear-all`

- **Guards**: `JwtAuthGuard`, `RolesGuard`, `@Roles('barber')`
- **Body**: _(none)_
- **Behavior**: Bulk-updates `notifications SET is_read = true WHERE
  recipient_id = :barberId AND recipient_type = 'barber' AND is_read =
  false`. Idempotent — second call returns `updated: 0`.

`ClearAllNotificationsResponseDto`:
```ts
{
  updated: number;   // count of rows transitioned from unread -> read
}
```

### 6.2 `POST /client/notifications/clear-all`

Identical shape and behavior, scoped to `recipient_type = 'client'` and
the authenticated client.

### Notes

- Status code: `200 OK` (`@HttpCode(200)` — Nest's default for POST is
  201, which doesn't fit "no resource created").
- No push fan-out — read-state changes are silent.
- No-op on already-read rows; safe to spam.

---

## 7. Client view of pending recurring arrangements

Barbers can propose a recurring arrangement to a client via `POST
/barber/recurring-arrangements`. The proposal lands in
`recurring_bookings` with `status = 'pending_client_approval'` and
`initiator = 'barber'`. Clients accept/reject from their app.

The existing `GET /client/recurring-arrangements?status=pending_client_approval`
already supports this filter, but the client UI needs a clearly named,
dedicated route for its "Pending Offers" tab.

### 7.1 `GET /client/recurring-arrangements/pending`

- **Guards**: `JwtAuthGuard`, `RolesGuard`, `@Roles('client')`
- **Query params** (all optional, forwarded to the underlying list):
  - `limit` — 1..50, default 20
  - `cursor` — UUID of last item from previous page
- **Behavior**: Thin wrapper that delegates to
  `RecurringArrangementsService.listForClient(clientAuthId, { ...query,
  status: 'pending_client_approval' })`. The `status` query param is
  ignored if passed — this endpoint always pins it to
  `pending_client_approval`.
- **Returns**: `RecurringArrangementsListResponseDto` — same shape as
  the generic list endpoint, so clients can reuse the same DTO mappers.

### Route ordering note

Declared **before** `@Get(':id')` in the controller so the literal
`pending` segment matches before the UUID-validated `:id` route — which
would otherwise reject `pending` with `400 BadRequest` from
`ParseUUIDPipe`.

### Why a dedicated endpoint instead of just the filter

- Single source of truth for the client UI — the screen can't
  accidentally request the wrong status.
- Future-proofs the response: if we later want to enrich pending-only
  payloads (e.g. expiry countdowns, conflict previews), the dedicated
  route is the place to do it without disturbing the generic list.

---

## 8. Barber `in_house_services` toggle

A barber-level boolean indicating whether the barber accepts in-house
(on-premises) services — separate from any service-level
`booking_type`. Surfaced as a toggle in the barber settings screen
alongside `auto_confirm`, `recurring_enabled`, and `no_show_charge`.

### 8.1 Schema

Migration:
`api/supabase/migrations/20260512000002_barber_in_house_services.sql`

```sql
ALTER TABLE public.barbers
  ADD COLUMN IF NOT EXISTS in_house_services boolean NOT NULL DEFAULT false;
```

- **Default `false`** so existing barbers must explicitly opt in.
- `NOT NULL` — the toggle is always either on or off; no tri-state.
- No RLS changes required — the column lives on `barbers`, which already
  enforces `auth.uid() = user_id` for owner-side updates. The settings
  endpoint also runs through the service-role client behind the
  `RolesGuard('barber')` check.

### 8.2 `PATCH /barber/settings/in-house-services`

- **Guards**: `JwtAuthGuard`, `RolesGuard`, `@Roles('barber')`
- **Body**: `UpdateInHouseServicesDto`
  ```ts
  {
    enabled: boolean;   // required, class-validator @IsBoolean
  }
  ```
- **Response**: `InHouseServicesResponseDto`
  ```ts
  {
    inHouseServices: boolean;   // echoed post-update value
  }
  ```
- **Errors**:
  - `404 NOT_FOUND` — caller's `barbers` row does not exist
    (`Barber profile not found`).
  - `500 INTERNAL_SERVER_ERROR` — DB update failed.

Mirrors the existing `PATCH /barber/settings/recurring` shape exactly —
clients can reuse the same toggle component pattern.

### 8.3 Affected files

#### SQL
- `supabase/migrations/20260512000002_barber_in_house_services.sql`
  _(new)_

#### TypeScript
- `src/modules/barbers/dto/update-in-house-services.dto.ts` _(new)_ —
  `UpdateInHouseServicesDto`, `InHouseServicesResponseDto`.
- `src/modules/barbers/barbers.service.ts` — adds
  `updateInHouseServices(barberId, enabled)`.
- `src/modules/barbers/barbers.controller.ts` — adds `PATCH
  /barber/settings/in-house-services` on `BarberSettingsController`.
- `src/modules/notifications/dto/notification.dto.ts` — adds
  `ClearAllNotificationsResponseDto`.
- `src/modules/notifications/notifications.service.ts` — adds
  `clearAll(recipientId, recipientType)`.
- `src/modules/notifications/notifications.controller.ts` — adds
  `POST /barber/notifications/clear-all` and
  `POST /client/notifications/clear-all`.
- `src/modules/bookings/recurring/recurring-arrangements.controller.ts`
  — adds `GET /client/recurring-arrangements/pending`.

### 8.4 Migration / deploy notes

1. Apply `20260512000002_barber_in_house_services.sql` before deploy.
   It is idempotent (`ADD COLUMN IF NOT EXISTS` + `DEFAULT false`) and
   safe to run live — existing reads of `barbers.*` automatically pick
   up the new column on the next query.
2. No data backfill required — the `DEFAULT false` covers every
   pre-existing row.
3. No client-side breakage: the new column appears in `select('*')`
   responses but old clients ignore unknown fields.

---

# Timezone Audit & Standardization (2026-05-12)

A pass over the whole booking time pipeline to lock in a single, explicit
timezone contract and eliminate a handful of latent risks. **No
breaking changes** — all DTO updates are additive, all existing fields
retain their semantics. UTC remains the storage format; barber-local is
the interpretation everywhere.

## 9. Timezone contract

The whole system follows three rules:

1. **Storage is UTC.** All persisted timestamps (`bookings.scheduled_at`,
   `confirmed_at`, `cancelled_at`, etc.) are `timestamptz` with values
   in UTC. All comparisons (`<`, `>=`, range overlap, advance notice)
   are UTC-instant against UTC-instant.
2. **Input is barber-local wall-clock.** Booking creation, preview, and
   recurring arrangement endpoints accept `date` (YYYY-MM-DD) +
   `slotTime` (HH:MM) interpreted in the **barber's** IANA timezone —
   never the server's, never the client's browser.
3. **Output ships every projection the frontend needs.** Every
   booking-shaped response now carries the canonical four fields:

   ```json
   {
     "scheduledAt": "2026-05-12T00:30:00.000Z",
     "timezone": "America/New_York",
     "appointmentDate": "2026-05-11",
     "appointmentTime": "20:30"
   }
   ```

   Frontends MUST render using either `(scheduledAt, timezone)` via
   `Intl.DateTimeFormat({ timeZone })` or the pre-projected
   `(appointmentDate, appointmentTime)`. Browser-local rendering is
   never safe — a barber in NYC and a client in Tokyo must both see
   the same calendar position.

## 10. Shared timezone utility

`src/modules/bookings/util/timezone.util.ts` _(new)_ — single source of
truth for time conversions. Exports:

| Symbol | Purpose |
|--------|---------|
| `composeUtcFromLocal(date, time, tz)` | Wall-clock → UTC `Date` (DST-aware, two-pass offset resolution) |
| `splitLocalDateTime(utc, tz)` | UTC → `{ date, time }` in `tz` |
| `localDateInTz(instant, tz)` | UTC → calendar date in `tz` |
| `tzOffsetMs(instant, tz)` | Signed ms offset of `tz` at `instant` |
| `isValidTimezone(tz)` | IANA validity check |
| `projectBookingTime(scheduledAtUtc, tz)` | Canonical 4-field projection for every booking DTO |
| `BARBER_DEFAULT_TIMEZONE` | `'UTC'` — fallback when `barbers.timezone` is null |
| `BookingTimeFields` | TS interface for the standard shape |

`recurring/recurring-time.util.ts` now re-exports the tz primitives from
the canonical module, keeping existing recurrence imports working.

### Duplicates removed

The same `composeUtcFromLocal` / `tzOffsetMs` / `splitLocalDateTime` /
`localDateInTz` implementations had been copy-pasted across multiple
services. Consolidated to the shared util:

- `bookings.service.ts` — removed private `composeUtcFromLocal`,
  `tzOffsetMs`, `splitLocalDateTime`, `formatLocalDate`,
  `dayOfWeekFromDate`.
- `availability.service.ts` — removed private `composeUtcFromLocal`,
  `tzOffsetMs`.
- `clients.service.ts` — removed private `splitLocalDateTime`.
- `bookings/recurring/recurring.service.ts` — removed private
  `splitLocalDateTime`.
- `barbers/home/barber-home.service.ts` — removed private
  `isValidTimezone`, `localDateInTz`.

All five sites now import from the canonical util.

## 11. Standardized booking DTOs

Every booking-returning DTO now exposes the canonical 4-field time
projection. **Additive only** — no fields removed, no semantics
changed for existing fields.

| DTO | Added fields |
|---|---|
| `BookingPreviewDto` | `timezone`, `appointmentDate`, `appointmentTime` |
| `ConfirmedBookingDto` | `timezone`, `appointmentDate`, `appointmentTime` |
| `CancelledBookingDto` | `timezone`, `appointmentDate`, `appointmentTime` |
| `ClientUpcomingBookingDto` | `scheduledAt`, `timezone` |
| `ClientPastBookingDto` | `scheduledAt`, `timezone`, `totalDurationMinutes`, `status` |
| `ClientBookingDetailDto` | `timezone`, `appointmentDate`, `appointmentTime` |
| `BarberBookingListItemDto` | `timezone`, `appointmentDate`, `appointmentTime` |
| `BarberBookingDetailDto` | `timezone`, `appointmentDate`, `appointmentTime` |
| `BarberHomePendingItemDto` | `timezone`, `appointmentDate`, `appointmentTime` |
| `BarberHomeScheduleItemDto` | `timezone`, `appointmentDate`, `appointmentTime` |

All four fields are populated through `projectBookingTime(...)` so the
shape is guaranteed identical across endpoints. Swagger
(`@ApiProperty`) descriptions document the exact contract on each
field.

## 12. Bugfixes & hardening

### 12.1 `availability.service.ts` — server-local Date math removed

`getAvailability()` previously expanded the requested date range with
`Date.setDate()` mutations, which interpret the receiver in the
**server's** local timezone. A server in a non-UTC tz could shift the
range by one day around midnight. Rewritten to use UTC-ms arithmetic
exclusively (`parseCalendarDateUtcMs`, `utcMsToDateStr`,
`dayOfWeekFromDate`). The barber tz is now the only timezone consulted —
never the server's.

### 12.2 `BARBER_DEFAULT_TIMEZONE` constant

The fallback for a missing `barbers.timezone` was hard-coded as the
string `'UTC'` in multiple call sites (`?? 'UTC'`). Replaced with the
exported `BARBER_DEFAULT_TIMEZONE` constant so the fallback can be
changed in one place and is visible to anyone grepping for tz
defaults.

### 12.3 Confirmed: recurrence engine is DST-safe

`computeOccurrenceDatesLocal` generates calendar dates in UTC-ms
space, then `recurring-booking-generator.service.ts` converts each
target date through `composeUtcFromLocal(date, slotTime, barber.tz)`
per occurrence. Because the offset is re-resolved per date, the
wallclock slot time is preserved across DST boundaries — the UTC
instant shifts by ±1h as expected. Pinned by new tests
(`weekly recurrence across DST` spring-forward and fall-back cases).

### 12.4 Confirmed: pause-window date comparison

`recurring-booking-generator.service.ts` compares `localDateInTz(...)`
against `recurring.pause_start_date` / `pause_end_date` via JS string
ordering. Both sides are zero-padded `YYYY-MM-DD` so lexicographic ==
chronological. Documented and left as-is; no fix required.

## 13. Tests

`src/modules/bookings/util/timezone.util.spec.ts` _(new)_ — 21 cases
covering:

- EST/EDT wall-clock round-trips (winter and summer)
- DST spring-forward boundary (2026-03-08) — 09:00 stays 09:00 local
- DST fall-back boundary (2026-11-01) — 09:00 stays 09:00 local
- Non-existent wall-clock during the spring-forward gap (02:30 NY)
- UTC-positive timezone (Asia/Tokyo, no DST)
- Slot crossing UTC day boundary (20:30 EDT → 00:30Z next day)
- Cross-timezone rendering of the same instant (NY vs Tokyo)
- `projectBookingTime` shape + Date-or-string input + empty-tz fallback
- IANA validity (`isValidTimezone`)
- Weekly recurrence across spring-forward and fall-back boundaries

## 14. Frontend rendering contract

Frontends MUST:

- Treat `scheduledAt` as a UTC instant; never call `new Date(scheduledAt)`
  without then formatting through `Intl.DateTimeFormat({ timeZone })`.
- Use `timezone` from the same DTO when formatting; never assume the
  browser timezone.
- Or render the pre-projected `appointmentDate` / `appointmentTime`
  directly when no formatting is needed.

Frontends MUST NOT:

- Concatenate `${appointmentDate}T${appointmentTime}` and feed it to
  `new Date(...)` — that interprets the wallclock as the browser's
  local timezone.
- Use `.toLocaleString()` / `.toLocaleDateString()` without an
  explicit `timeZone` option.

## 15. Affected files

### TypeScript
- `src/modules/bookings/util/timezone.util.ts` _(new)_ — canonical tz
  module.
- `src/modules/bookings/util/timezone.util.spec.ts` _(new)_ — DST,
  midnight, cross-tz, projection coverage.
- `src/modules/bookings/recurring/recurring-time.util.ts` — re-exports
  tz primitives from the canonical util.
- `src/modules/bookings/bookings.service.ts` — uses shared util;
  preview / confirm / cancel / client detail / upcoming / past now
  return the 4-field shape.
- `src/modules/bookings/availability.service.ts` — UTC-ms date math;
  shared util import; removed private tz duplicates.
- `src/modules/bookings/recurring/recurring.service.ts` — uses shared
  `splitLocalDateTime`.
- `src/modules/barbers/barbers.service.ts` — list & detail now populate
  `timezone` + `appointmentDate` + `appointmentTime`; loads barber tz
  once per request via `fetchBarberTimezone`.
- `src/modules/barbers/home/barber-home.service.ts` — schedule & pending
  items carry the 4-field shape; private duplicates removed.
- `src/modules/clients/clients.service.ts` — uses shared util.
- `src/modules/bookings/dto/preview-booking-response.dto.ts`,
  `confirm-booking-response.dto.ts`, `cancel-booking-response.dto.ts`,
  `client-upcoming-booking.dto.ts`, `client-past-booking.dto.ts`,
  `client-booking-detail.dto.ts` — additive DTO fields.
- `src/modules/barbers/dto/barber-booking-list-item.dto.ts`,
  `barber-booking-detail.dto.ts` — additive DTO fields.
- `src/modules/barbers/home/dto/barber-home-response.dto.ts` — additive
  DTO fields on pending & schedule items.

### SQL
- _(none)_ — `bookings.timezone` is already on the `barbers` row and the
  `get_barber_home` RPC; no schema change required.

## 16. Migration / deploy notes

1. No DB migration. Deploy the API; new fields appear on every booking
   response automatically.
2. No backfill — every response is computed from existing
   `bookings.scheduled_at` (UTC) and `barbers.timezone` at read time.
3. **No client-side breakage.** Every legacy field is preserved. Old
   apps that read `appointmentDate` / `scheduledAt` continue to work
   unchanged; new apps SHOULD switch to the 4-field shape so they no
   longer need to fetch the barber's tz separately.
4. Server timezone: the API no longer depends on `process.env.TZ` or
   the host's local tz for any booking computation. The host tz can be
   anything; behavior is identical.
