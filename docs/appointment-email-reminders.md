# Appointment Email Reminders (Resend)

Automated email reminders sent before appointments. Each barber configures two
**independent** groups:

- **Client reminders** — emailed to the barber's clients.
- **Self reminders** — emailed to the barber for the same bookings.

Each group is enabled/disabled on its own and has a **single** option:

| `reminder_type`  | Meaning                                                        |
| ---------------- | ------------------------------------------------------------- |
| `hours_before`   | `offset_hours` before the appointment (absolute offset).      |
| `minutes_before` | `offset_minutes` before the appointment (absolute offset).    |
| `morning_of`     | 09:00 on the appointment day, in the **barber's** timezone.   |

## Timezone rule

All date math uses the barber's IANA timezone (`barbers.timezone`). `morning_of`
anchors to 09:00 barber-local on the appointment's local date; the hour/minute
options are absolute offsets from the appointment instant. Every timestamp is
stored UTC (`timestamptz`) and converted at compute time via the shared
`bookings/util/timezone.util` primitives (`Intl`-based, DST-correct). Email
bodies render the time in the barber's timezone with the zone shown.

## Hybrid scheduler

**1. Precompute (event-driven).** On booking create
(`BookingsService.confirmBooking → RemindersService.onBookingCreated`) and on
settings change (`updateGroup → recomputeForBarber`), one
`scheduled_reminders` row is upserted per booking per eligible recipient with
the computed `send_at`. The unique constraint `(booking_id, recipient_type)`
makes the upsert idempotent.

**2. Dispatch (cron, every minute).** `ReminderDispatchCron`:

- Calls the `claim_due_reminders` RPC, which atomically flips due `pending`
  rows to `sending` (and bumps `attempts`) using `FOR UPDATE SKIP LOCKED`, so
  overlapping cron runs never send the same reminder twice. It also reclaims
  rows stuck in `sending` (a crashed previous run).
- Sends each claimed row via Resend (`MailService`), then marks it `sent`
  (with `resend_message_id`), `failed` (after `MAX_ATTEMPTS`), or back to
  `pending` for retry.
- Runs a **safety-net reconcile**: fills missing reminder rows for future
  eligible bookings of barbers with reminders enabled — covering bookings whose
  precompute handler was missed (e.g. recurring-generated bookings).

## Lifecycle & edge cases

- **Created** → compute `send_at` for each enabled group with an emailable
  recipient.
- **Cancelled** → `onBookingCancelled` flips that booking's `pending` reminders
  to `cancelled`. (Bulk/recurring cancel paths are covered defensively at
  dispatch: a reminder for an ineligible booking is `skipped`, never sent.)
- **Settings changed** → recompute future bookings: schedule newly-enabled,
  cancel disabled.
- **`send_at` already past at compute** → `skipped` (configurable grace via
  `REMINDER_GRACE_MINUTES`, default 0). `morning_of` booked same-day after
  09:00 is therefore skipped.
- **Missing recipient email** → `skipped` with an `error` note (never errors).
- **Resend failure** → `attempts++`, error stored, retried up to
  `MAX_ATTEMPTS` (3), then `failed`.
- **Already `sent`** → never re-sent or clobbered.

There is no reschedule endpoint in this codebase (bookings are cancel +
recreate), so reschedule is handled by the cancel + create paths above.

## Schema

`supabase/migrations/20260520000001_appointment_email_reminders.sql`:

- `barber_reminder_settings` — `(barber_id, target)` unique; CHECK that the
  offset matching `reminder_type` is present and positive.
- `scheduled_reminders` — `(booking_id, recipient_type)` unique; index on
  `(status, send_at)` for the dispatch query.
- `claim_due_reminders(p_now, p_stale_minutes, p_limit)` — SECURITY DEFINER,
  service-role only.

`barbers.timezone` already exists (migration `20260413000002`).

## Endpoints (barber-scoped, JWT + role `barber`)

- `GET /barber/reminder-settings` → both groups.
- `PUT /barber/reminder-settings/:target` (`target` = `client` | `self`).

## Env

| Var                     | Purpose                                                  |
| ----------------------- | -------------------------------------------------------- |
| `RESEND_API_KEY`        | Resend API key.                                          |
| `RESEND_FROM_EMAIL`     | Verified sender. **Domain must be verified in Resend.**  |
| `REMINDER_GRACE_MINUTES`| Optional past-due grace window (default 0).              |
