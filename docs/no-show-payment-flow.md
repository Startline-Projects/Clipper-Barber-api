# No-Show Payment Flow

Audience: backend + mobile teams. Covers the client-initiated no-show resolution
flow that replaced the legacy auto-charge implementation.

## TL;DR

1. Barber marks a confirmed/completed booking as `no_show` (after the appointment window ends).
2. The backend writes a row to `no_shows` with `status = 'unresolved'` (or skips creation if the barber has `no_show_charge_enabled = false` / amount `<= 0`).
3. The client sees their unresolved no-shows in their app (`GET /client/no-shows`).
4. The client pays one no-show at a time: `POST /client/no-shows/:id/pay` returns a Stripe PaymentIntent `client_secret`. The mobile/web SDK confirms the payment on-session.
5. Stripe sends `payment_intent.succeeded` → the webhook flips the row to `status = 'paid'`, sets `resolved_at`, and mirrors `bookings.no_show_charged` for legacy consumers.
6. If a client accumulates **≥ 3** unresolved no-shows, barber-facing client APIs surface a soft warning (`hasBlockedNoShows: true`). **Booking creation is NOT blocked** by the backend; the frontend decides what UX to show.

## Audience: Barber or Client?

| API                                  | Side     | Status   |
| ------------------------------------ | -------- | -------- |
| `PATCH /barber/bookings/:id/no-show` | Barber   | Modified (no longer auto-charges) |
| `GET /barber/no-shows`               | Barber   | NEW      |
| `GET /barber/no-shows/stats`         | Barber   | NEW      |
| `GET /client/no-shows`               | Client   | NEW      |
| `POST /client/no-shows/:id/pay`      | Client   | NEW      |
| `GET /client/barbers/:barberId`      | Client   | Modified (added `unresolvedNoShowsCount`, `hasBlockedNoShows`) |
| `POST /webhooks/stripe`              | Stripe   | Modified (handles `kind=no_show_resolution` PaymentIntents)   |

## Status machine

```
            ┌── (barber marks booking no_show)
            ▼
       unresolved ─────────► pending_payment ─────► paid
            ▲                       │
            │                       │ (stripe failure)
            │                       ▼
            └────────────────── failed
                                    │
                                    │ (manual / refund)
                                    ▼
                                 refunded
```

* `unresolved` — created at mark-time, awaits client action.
* `pending_payment` — client called `/pay`; a PaymentIntent exists but is not yet settled.
* `paid` — webhook confirmed `payment_intent.succeeded`. Money is on the way to the barber Connect account.
* `failed` — webhook confirmed `payment_intent.payment_failed`. Client may retry; calling `/pay` again will create a fresh PaymentIntent or reuse a recoverable one.
* `refunded` — manual ops state, used by future refund flow. Counted as resolved (not owed).

For the **unresolved count surfaced to barber APIs**, `unresolved` + `failed` are grouped together — a declined card still means money is owed.

## DB schema

Migration: `supabase/migrations/20260512000003_no_show_payment_flow.sql`.

```
no_shows (
  id, booking_id (UNIQUE), client_id, barber_id,
  amount_usd, currency, reason,
  status no_show_status,
  stripe_payment_intent_id (UNIQUE WHERE NOT NULL),
  stripe_transfer_id, payment_metadata jsonb,
  resolved_at, created_at, updated_at
)
```

Indexes:
* `no_shows_one_per_booking (booking_id)` — guarantees one no-show per booking.
* `no_shows_payment_intent_unique` — prevents two rows binding the same PI.
* `no_shows_client_status_created (client_id, status, created_at DESC)`
* `no_shows_barber_status_created (barber_id, status, created_at DESC)`

RLS:
* Read-own for client (`auth.uid() = client_id`) and barber (`auth.uid() = barber_id`).
* Writes are service-role only (no client-facing INSERT/UPDATE policies).

Helper function:
* `client_unresolved_no_show_count(p_client_id uuid) → int` — used by the client APIs to surface the soft-warning flag without scanning the table from JS.

Backfill: existing `bookings` with `status = 'no_show'` get a row at migration time — `paid` if `no_show_charged = true`, else `unresolved`.

## Stripe integration

* **Connect**: each barber owns an Express account (`barbers.stripe_connect_account_id`). The `/pay` endpoint refuses if the barber's account is missing or `charges_enabled = false`.
* **Customer**: each client has `clients.stripe_customer_id` set when they first add a card. Re-used for new PaymentIntents.
* **PaymentIntent.create**:
  * `amount`: `no_shows.amount_usd * 100` (USD cents)
  * `currency`: `'usd'`
  * `customer`: client's Stripe customer id (optional but required for saved-card UX)
  * `transfer_data.destination`: barber's Connect account → funds settle on the barber's balance
  * `automatic_payment_methods.enabled: true` — Stripe picks the best payment method (card / Apple Pay / Google Pay)
  * `metadata`: `{ kind: 'no_show_resolution', no_show_id, booking_id, barber_id, client_id }`
  * Idempotency key: `no_show_init_<no_show_id>` — repeated calls within 24h return the same PI rather than duplicates.
* **Webhooks** (signature-verified at `/webhooks/stripe`, raw body): `payment_intent.succeeded` and `payment_intent.payment_failed` are routed to `settleNoShowResolution()` when `metadata.kind === 'no_show_resolution'`.

## Security & invariants

* **Authorization**: `POST /client/no-shows/:id/pay` verifies `no_shows.client_id === auth.uid()` before creating the PaymentIntent. A 403 is returned otherwise.
* **Double-payment**: re-calling `/pay` against a `paid` or `refunded` row returns 409. Against an `unresolved`/`failed` row that already has a recoverable PI, the same `client_secret` is returned — no second PI is created.
* **Webhook spoofing**: Stripe signature is verified using `STRIPE_WEBHOOK_SECRET`. Invalid signatures get a 400; the body is never parsed for unsigned events.
* **Replay / duplicate webhooks**: idempotency comes from the `subscription_events.stripe_event_id` unique index (existing). A duplicate webhook short-circuits before any handler runs.
* **Race condition on `/pay`**: the `no_shows_one_per_booking` unique index plus the conditional `UPDATE … WHERE status IN ('unresolved','failed','pending_payment')` on settlement ensure a row can't be settled twice or downgraded after being marked `paid`.
* **Webhook is source of truth**: the API never flips a row to `paid` itself. Even after the SDK returns success on the client side, the backend waits for the webhook before marking the row resolved.

## API contracts

### `GET /client/no-shows`

Query: `?status=&page=&limit=` (limit ≤ 50, default 20).

```json
{
  "items": [
    {
      "id": "…", "status": "unresolved", "amountUsd": 25, "currency": "usd",
      "reason": null,
      "createdAt": "2026-05-10T14:00:00.000Z", "resolvedAt": null,
      "booking": { "id": "…", "scheduledAt": "2026-05-10T14:00:00.000Z", "serviceName": "Haircut" },
      "counterparty": { "id": "…", "name": "Mike Barber", "profilePhotoUrl": "https://…" }
    }
  ],
  "pagination": { "currentPage": 1, "totalPages": 1, "totalItems": 1, "limit": 20, "hasNextPage": false }
}
```

Sort: `unresolved` and `failed` first (oldest first within the bucket), then `paid` and `refunded` (newest first).

### `POST /client/no-shows/:id/pay`

```json
{
  "noShowId": "…",
  "paymentIntentId": "pi_…",
  "clientSecret": "pi_…_secret_…",
  "status": "pending_payment",
  "amountUsd": 25,
  "currency": "usd"
}
```

Errors:
* `403` — caller is not the owning client.
* `404` — no-show not found.
* `409` — already paid/refunded OR barber Connect account not ready.
* `400` — invalid amount.

### `GET /barber/no-shows`

Same shape as the client list, but `counterparty` is the client. Same query params and same sort order.

### `GET /barber/no-shows/stats`

```json
{
  "stats": {
    "unresolvedCount": 4, "unresolvedAmountUsd": 100,
    "resolvedCount": 12,  "resolvedAmountUsd": 360,
    "totalEarningsUsd": 360
  }
}
```

### `GET /client/barbers/:barberId` (modified)

Adds two new top-level fields. **No fields removed.**
```json
{
  "barber": { … },
  "services": [ … ],
  "reviews": [ … ],
  "reviewsSummary": { … },
  "distance": { … },
  "hasActivePlan": false,
  "unresolvedNoShowsCount": 3,
  "hasBlockedNoShows": true
}
```

## Edge cases handled

* **Barber re-marks the same booking**: `markNoShow` already errors on `status = 'no_show'`. If somehow the unique index is exercised, `recordUnresolved` returns the existing row instead of throwing.
* **Barber has no-show charge disabled or amount = 0**: no `no_shows` row is created. The booking is still marked `no_show`.
* **Client retries `/pay` after a failed payment**: the previous PI is re-checked; if still recoverable (`requires_payment_method` etc.), the same `client_secret` is returned. Otherwise a new PI is created (with the same idempotency key — the PI may differ if more than 24h elapsed).
* **Webhook arrives before the API response returns**: irrelevant. The webhook settles the row independently; both paths converge to `paid`.
* **Connect account becomes invalid between mark-no-show and `/pay`**: `/pay` returns 409 with a clear message. The client cannot pay until the barber re-enables.
* **Refunds**: the `refunded` status is reserved for the future ops flow — no API surfaces it today, but the count helper already treats it as not-owed.

## What changed from the legacy flow

| Before | After |
| ------ | ----- |
| `BarbersService.markNoShow` auto-charged off-session via `NoShowService.charge()` | `BarbersService.markNoShow` records an `unresolved` no-show; payment is the client's responsibility |
| Money moved at mark-time | Money moves at client-confirm time |
| `no_show_charges` audit table | New `no_shows` operational table (legacy `no_show_charges` left in place, no longer written by app code) |
| Webhook `kind=no_show` settled audit rows | Webhook `kind=no_show_resolution` settles `no_shows` rows; legacy `no_show` branch kept for in-flight events |
| `chargeResult` on the response carried `{ charged, reason }` | Same shape preserved; `charged` is always `false` (no immediate charge), `noShowChargeId` is the `no_shows.id` |
