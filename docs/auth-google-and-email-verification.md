# Auth — Google sign-in & email verification

New endpoints added to the auth module to support:

- Google sign-in for clients (native id_token flow).
- Email verification for both client and barber signups created with email + password.

All endpoints live under the existing `/auth` controller.

---

## 1. `POST /auth/google` — Client app only

Used by the **Client** app. The Barber app must not call this endpoint.

### Flow

1. The Client app uses a native Google Sign-In SDK (e.g. `expo-auth-session` with Google provider, or `@react-native-google-signin/google-signin`) to obtain a Google **id_token**.
2. The app POSTs that token to `/auth/google`.
3. The backend exchanges it with Supabase via `signInWithIdToken({ provider: 'google', token })`. Supabase either matches an existing auth user by email or provisions a new one with `email_verified = true` (Google has already attested the email — no verification email needed for Google sign-ins).
4. On first sign-in only, the backend also inserts the matching `clients` row (username derived from the request or from the email local-part) and sets `user_metadata.role = 'client'`.
5. Returns the same shape as `POST /auth/login` for clients.

### Request

```json
POST /auth/google
{
  "idToken": "eyJhbGciOi...",          // required — Google OIDC id_token
  "accessToken": "ya29....",           // optional — only if id_token lacks a nonce
  "username": "john_doe"               // optional — used only on first sign-in
}
```

### Response — 201

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "id": "uuid",
  "email": "user@gmail.com",
  "username": "john_doe"
}
```

### Errors

- `401 GOOGLE_INVALID_TOKEN` — id_token rejected by Supabase / Google.
- `409 GOOGLE_ROLE_RESERVED` — the email already belongs to a barber account. Barbers must sign in with email + password through the standard `/auth/login`.

### What the Client app must do

- Configure native Google Sign-In with the **Web Client ID** from the Supabase-linked Google Cloud project. Pass that web client ID as the `clientId` (iOS/Android may also need their own client IDs configured in Google Cloud, but the Web client ID is what Supabase verifies the `aud` claim against).
- After receiving the response, store `accessToken` + `refreshToken` the same way it stores them after a normal password login.
- No verification step is required after Google sign-in — Supabase marks the email as verified automatically.

---

## 2. `POST /auth/verify-email` — Both apps

Used by **both** the Client app and the Barber app to confirm the email address after a password signup.

### Flow

1. User signs up via `POST /auth/client/register` (Client app) or `POST /auth/barber/step1` (Barber app). Both flows now create the auth user as **unverified** and trigger Supabase to send a confirmation email.
2. The email contains a link of the form `<scheme>://auth/confirm?token_hash=<hash>&type=signup` (configured in the Supabase email template). The scheme is `clipper://` for the Barber app and `clipperclient://` for the Client app.
3. The app's deep-link handler extracts `token_hash` from the URL.
4. The app POSTs the token to `/auth/verify-email`.

### Request

```json
POST /auth/verify-email
{
  "token": "<token_hash from the email URL>",
  "type": "signup"                       // optional — defaults to "signup". Use "email" for email-change confirmations.
}
```

### Response — 201

```json
{ "success": true }
```

### Errors

- `401 EMAIL_VERIFY_FAILED` — token invalid, expired, or already used.

### Notes

- The signup flow returns tokens immediately, so the user can use the app before verifying their email (this also lets the Barber multi-step onboarding proceed). Verification can happen any time afterwards.
- If you'd rather block unverified accounts from using the app entirely, leave Supabase's "Allow unverified email sign-ins" setting OFF — then `/auth/login` will reject unconfirmed users until they hit `/auth/verify-email`.

---

## 3. `POST /auth/resend-verification` — Both apps

Used by **both** apps to re-send the signup confirmation email (e.g. user lost the original or it expired).

### Request

```json
POST /auth/resend-verification
{
  "email": "user@example.com"
}
```

### Response — 201

```json
{ "success": true }
```

Always returns success to avoid leaking which emails are registered.

---

## Behavior changes to existing endpoints

### `POST /auth/barber/step1`

Previously created the barber's auth user with `email_confirm: true` (i.e. emails were silently auto-verified). Now creates the user with `email_confirm: false` and triggers a confirmation email in the background. **The response shape is unchanged** — tokens are still issued immediately so steps 2–4 can proceed without waiting on verification.

### `POST /auth/client/register`

Same change as `barber/step1`. **Response shape unchanged** — the client receives tokens immediately and can verify their email at their leisure.

---

## Required Supabase dashboard configuration

These cannot be done from code — they must be configured manually in the Supabase project.

1. **Auth → Providers → Google**: enable. Add your Google Cloud project's **Web Client ID** (and any native iOS/Android client IDs, comma-separated) under "Authorized Client IDs".
2. **Auth → Sign In / Up → Email**:
   - "Confirm email" → **ON**.
   - "Allow unverified email sign-ins" → **ON** (so the Barber multi-step onboarding can keep its tokens before verification).
3. **Auth → URL Configuration → Redirect URLs**: add
   ```
   clipper://auth/confirm
   clipperclient://auth/confirm
   ```
4. **Auth → Email Templates → Confirm signup**: edit the template so the link target uses the app scheme. Recommended template body:
   ```html
   <a href="clipperclient://auth/confirm?token_hash={{ .TokenHash }}&type=signup">
     Confirm your email
   </a>
   ```
   Note: Supabase has only one global template per project. If both apps live under one project, the link must either pick a scheme (and rely on the right app being installed) or route through a small web page on your own domain that detects the role and redirects to the appropriate scheme.
5. **Auth → SMTP**: configure a real SMTP provider (Resend / Postmark / SES / etc.). Supabase's default SMTP is rate-limited to ~3 emails/hour and is not usable in production.
6. **Google Cloud Console** (outside Supabase): create OAuth 2.0 client IDs for Web, iOS, and Android in the same project. The Web client's authorized redirect URI must include `https://<your-project>.supabase.co/auth/v1/callback`.

---

## Notification-system changes (2026-05-16)

The following existing endpoints had their notification side effects modified.
Request/response shapes are unchanged — only the notifications fired by the
backend changed.

### `POST /bookings/confirm` — Client app

**Change:** When the barber has auto-confirmation enabled (`allow_auto_confirm`
or `auto_confirm_today` for today's bookings) and the booking is created with
`status = 'confirmed'`, the backend now also dispatches a `booking_confirmed`
notification to the client. This mirrors the notification that the client
receives when a barber manually confirms a pending booking, so auto-confirmation
is now a first-class confirmation event.

- Auth: client JWT (unchanged).
- Request / response: unchanged.
- New notification (client recipient): `booking_confirmed`.
- Unchanged notification (barber recipient): `new_booking`.

### `POST /recurring-bookings/:id/pause` and `POST /recurring/:id/pause`

**Change:** Pausing a recurring arrangement now notifies the **other party**
regardless of who initiated the pause.

- Previously: only fired `recurring_paused` to the barber when the client paused;
  a barber-initiated pause produced no notification.
- Now: client-initiated pause → `recurring_paused` to the barber (unchanged).
  Barber-initiated pause → `recurring_paused` to the client (new).
- Auth, request and response: unchanged.

### `POST /recurring-bookings/:id/resume` and `POST /recurring/:id/resume`

**Change:** Resuming a recurring arrangement now dispatches a notification to the
**other party** regardless of who initiated the resume. Previously the resume
endpoint sent no notification at all.

- New notification type: `recurring_resumed` (added to the `notification_type`
  Postgres enum and `NotificationTypeDto`). Title: "Recurring Resumed".
- Client-initiated resume → `recurring_resumed` to the barber.
- Barber-initiated resume → `recurring_resumed` to the client.
- Auth, request and response: unchanged.

### Migration

- `supabase/migrations/20260516000001_notification_recurring_resumed.sql` —
  additive `ALTER TYPE notification_type ADD VALUE IF NOT EXISTS
  'recurring_resumed'`. Backwards-compatible; no existing recurring arrangement
  data is touched.

---

---

## Subscriptions — Reactivate, upgrade error, lifecycle notifications

The subscription module gained one new endpoint and a corrected error contract.
All routes live under `/subscriptions` and require a client JWT.

### `POST /subscriptions/me/reactivate` — Client app only

Clears a pending cancellation on the **existing** Stripe subscription. Used
when a user changed their mind before period end. No new Stripe subscription
is created; no proration occurs.

#### Flow

1. The user has previously called `DELETE /subscriptions/me`, so
   `subscription_cancel_at_period_end = true` and the period has not yet ended
   (status is still `active`).
2. The client app calls `POST /subscriptions/me/reactivate`.
3. The backend calls `stripe.subscriptions.update(..., { cancel_at_period_end: false })`
   on the stored `stripe_subscription_id`.
4. Mirrors `subscription_cancel_at_period_end = false` back onto the `clients`
   row. Status was never flipped off `active`, so no status change is needed.
5. Returns the current state. Stripe's `customer.subscription.updated` webhook
   will reconfirm shortly.

#### Request

```json
POST /subscriptions/me/reactivate
{}
```

No body required.

#### Response — 200

```json
{
  "status": "active",
  "cancelAtPeriodEnd": false,
  "plan": "monthly",
  "currentPeriodEnd": "2026-05-27T00:00:00.000Z"
}
```

#### Errors

- `400 SUBSCRIPTION_NOT_SCHEDULED_FOR_CANCELLATION` (BadRequestException) —
  the subscription is not in a cancel-at-period-end state, so there is nothing
  to reactivate. Use `POST /subscriptions` to start a new one.
- `404 NOT_FOUND` — no `stripe_subscription_id` recorded for the client.

### `PATCH /subscriptions/me/plan` — downgrade error code change

Behaviour and request/response are unchanged for the supported direction
(monthly → yearly with `proration_behavior: 'always_invoice'`).

**Error contract change:** an attempt to downgrade (yearly → monthly) now
returns **HTTP 400** with the message:

```
Downgrading from yearly to monthly is not supported. Please cancel and re-subscribe.
```

Previously this returned 409. Error code (`PLAN_DOWNGRADE_NOT_ALLOWED`) is
unchanged.

The successful upgrade response now reflects the post-proration
`currentPeriodEnd` immediately rather than waiting for the webhook —
clients no longer need to refetch state to see the new period end.

### Subscription lifecycle notifications

Five new `NotificationTypeDto` values are dispatched by the payments module:

| Type                            | Sent when                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `subscription_activated`        | First-time activation. Fires from the `customer.subscription.updated` webhook on `!active → active` (excluding `past_due → active`). |
| `subscription_reactivated`      | `past_due → active` transition. Fires from `invoice.payment_succeeded` (or the subscription upsert webhook). |
| `subscription_cancel_scheduled` | Fires from `DELETE /subscriptions/me` after the Stripe call succeeds.                       |
| `subscription_cancelled`        | Fires from the `customer.subscription.deleted` webhook at actual period end.                |
| `subscription_past_due`         | Fires from `invoice.payment_failed` (only on the first transition into past_due).           |

All notifications go to the client (`recipient_type = 'client'`). Bodies use
fixed copy — they bypass the booking-centric formatter via the new
`NotificationsService.createAndSendSubscriptionNotification(clientUserId, type)`
method. Push delivery is best-effort and never rolls back the originating action.

### Migration

- `supabase/migrations/20260517000001_notification_subscription_types.sql` —
  additive `ALTER TYPE notification_type ADD VALUE IF NOT EXISTS` for each of
  the five subscription lifecycle values. Backwards-compatible.

---

## Recurring booking details — profile photo URLs (additive)

Both recurring-details endpoints now include the other party's profile photo
URL on the shared `RecurringBookingDto` payload (and therefore on
`RecurringBookingDetailDto`).

| Endpoint                                | Auth   | What changed in response                                                                                                                                                                |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /barber/recurring-bookings/:id`    | Barber | Adds `clientProfilePhotoUrl: string \| null` (the client's photo). Also includes `barberProfilePhotoUrl` for symmetry.                                                                   |
| `GET /client/recurring-bookings/:id`    | Client | Adds `barberProfilePhotoUrl: string \| null` (the barber's photo). Also includes `clientProfilePhotoUrl` for symmetry.                                                                   |

- `barberProfilePhotoUrl` sourced from `barbers.profile_photo_url`.
- `clientProfilePhotoUrl` sourced from `clients.profile_photo_url`.
- Returned as the raw public URL stored in the DB (same pattern as the
  recurring-arrangements summary endpoints — no signing/proxying). `null` when
  the underlying row has no photo set.
- No existing fields renamed or removed; pure addition.

## Barber home — `earningsSoFarUsd` confirmed semantics

The `today.earningsSoFarUsd` field on `GET /barber/home` (returned by
`BarberHomeService.getHome` via the `get_barber_home` Postgres RPC) was audited
and is correct. Documenting the exact contract so it does not need to be
reverse-engineered again:

| Aspect              | Value                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| **Endpoint**        | `GET /barber/home` (auth: Barber)                                                                  |
| **Time window**     | Today only — `[v_day_start, v_day_end)` computed as a single calendar day in the barber's resolved timezone (DST-safe via `AT TIME ZONE`). |
| **Filter**          | `bookings.barber_id = $barber` AND `scheduled_at` within the day window AND `status = 'completed'`. Cancelled/pending/confirmed are excluded. |
| **Aggregation**     | `COALESCE(SUM(price_usd) FILTER (WHERE status = 'completed'), 0)` — performed inside the SQL RPC (`supabase/migrations/20260512000001_barber_home_multi_service.sql`), not in JS. |
| **Column summed**   | `bookings.price_usd` (the per-booking gross price locked at booking creation). Note: this is the gross price, not a barber-net amount — there is no separate net column on `bookings`. |
| **Currency unit**   | USD as decimal (`numeric(10,2)`). No cents/minor-unit conversion needed.                           |
| **Null handling**   | SQL `COALESCE(..., 0)` ensures the aggregation returns `0` when no completed bookings exist; the service layer also applies `Number(... ?? 0)` defensively. |

## Endpoint-to-app matrix

| Endpoint                              | Client app | Barber app |
| ------------------------------------- | :--------: | :--------: |
| `POST /auth/google`                   |     ✅     |     ❌     |
| `POST /auth/verify-email`             |     ✅     |     ✅     |
| `POST /auth/resend-verification`      |     ✅     |     ✅     |
| `POST /subscriptions/me/reactivate`   |     ✅     |     ❌     |
