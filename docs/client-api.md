# Client API Reference

Target audience: the mobile **client app** (developers integrating the React Native / Expo client-side app — the user-facing booking experience).

This document covers every endpoint a client user hits — from registration through browsing barbers, booking (one-off and recurring), reviewing, chatting, and receiving notifications.

---

## Table of Contents

1. [Conventions](#conventions)
2. [Shared Enums](#shared-enums)
3. [Auth](#1-auth)
4. [Profile](#2-profile)
5. [Subscriptions & Stripe Payment Flow](#3-subscriptions--stripe-payment-flow)
6. [Browse Barbers](#4-browse-barbers)
7. [Availability (one-off bookings)](#5-availability-one-off-bookings)
8. [Bookings — Preview, Confirm, Manage](#6-bookings--preview-confirm-manage)
9. [Recurring Bookings](#7-recurring-bookings)
10. [Reviews](#8-reviews)
11. [Conversations / Messaging](#9-conversations--messaging)
12. [Push Notifications](#10-push-notifications)
13. [Common Error Codes](#common-error-codes)
14. [End-to-End Booking Flow](#end-to-end-booking-flow-cheat-sheet)

---

## Conventions

- **Base URL:** `http://localhost:3000` (dev). Production URL is environment-specific.
- **Auth header:** `Authorization: Bearer <accessToken>` on every endpoint marked **Auth: required**.
- **Role gating:** Endpoints under `role: client` reject other roles with HTTP `403`. The role is read from the JWT — the mobile app sends the role only on `POST /auth/login`.
- **Content type:** `application/json`.
- **Date / time format:**
  - Calendar dates: `YYYY-MM-DD` (in the **barber's** local timezone — relevant for booking inputs and outputs).
  - Times of day: `HH:mm` (24-hour).
  - Timestamps (`createdAt`, `scheduledAt`, etc.): ISO 8601 UTC.
- **`dayOfWeek`** is `0..6` where `0 = Sunday` and `6 = Saturday`.
- **Validation:** Global `ValidationPipe` strips unknown fields and rejects extras with `400`.
- **Error shape:**
  ```json
  { "error": true, "message": "Human-readable message", "code": "OPTIONAL_CODE" }
  ```
  - `400` validation, `401` auth, `403` role, `404` not found, `409` conflict (double-booking, etc.), `500` server.
- **Pagination:**
  - **Page-based** (barbers list, client bookings, conversations, notifications): `page` + `limit`. Response wraps a `pagination` block with `currentPage`, `totalPages`, `hasNextPage`, `limit`, and a total count (`totalBarbers` / `totalBookings` / etc.).
  - **Cursor-based** (recurring bookings, reviews, messages): `cursor=<id-of-last-item>` + `limit`. Response returns `nextCursor` + `hasMore`.
- **Subscription gating:** browse/profile/messaging endpoints are open to any authenticated client, but **booking actions require an active subscription**. The following routes are guarded — they return `403` with code `SUBSCRIPTION_REQUIRED` when `clients.subscription_status` is not `active`:
  - `GET /barbers/:barberId/availability`
  - `POST /bookings/preview`
  - `POST /bookings/confirm`
  - `GET /client/barbers/:barberId/recurring-slots`
  - `POST /client/recurring-bookings`

  Treat `SUBSCRIPTION_REQUIRED` as a signal to route the user to the paywall (Section 3) before retrying.

---

## Shared Enums

```ts
// Service types
ServiceType         = 'haircut' | 'beard' | 'haircut_beard' | 'eyebrows' | 'other'

// Booking pricing tier — chosen per service in the cart
BookingType         = 'regular' | 'after_hours' | 'day_off'

// Booking lifecycle (visible to clients on their own bookings)
BookingStatus       = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'

// Recurring
RecurringFrequency  = 'weekly' | 'biweekly'
RecurringStatus     = 'pending_barber_approval' | 'active' | 'paused' | 'cancelled' | 'expired'
ClientRecurringStatus = 'active' | 'paused' | 'pending_approval'   // collapsed status for the client list view

// Browse barbers
BarberSort          = 'nearest' | 'top_rated'
RecurringFilter     = 'available' | 'not_available'

// Other
CancelledBy         = 'client' | 'barber'
DevicePlatform      = 'ios' | 'android'

// Notification types pushed to the client:
NotificationType =
    | 'booking_confirmed'
    | 'booking_cancelled'
    | 'recurring_accepted'
    | 'recurring_refused'
    | 'recurring_expiring'
    | 'new_message'
```

> **Important constants:** `MAX_SERVICES_PER_BOOKING = 4` (a single booking can stack up to 4 back-to-back services).

---

## 1. Auth

### 1.1 `POST /auth/client/register`

Single-step client signup.

- **Auth:** none
- **Body** (`ClientRegisterDto`):
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `email` | string | yes | valid email |
  | `password` | string | yes | min 8 |
  | `username` | string | yes | 3..30, letters/digits/underscores only |
- **Response 201** `TokensResponseDto`:
  ```json
  { "accessToken": "<jwt>", "refreshToken": "<jwt>" }
  ```
- Errors: `409` if email or username is already taken.

### 1.2 `POST /auth/login`

- **Auth:** none
- **Body:**
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `email` | string | yes | |
  | `password` | string | yes | min 8 |
  | `role` | `'barber' \| 'client'` | yes | sent by the app — for the client app this is always `"client"` |
- **Response 201** (`LoginResponseDto`):
  ```json
  {
    "accessToken": "<jwt>",
    "refreshToken": "<jwt>",
    "id": "<user-uuid>",
    "email": "client@example.com",
    "username": "john_doe"
  }
  ```
  *(`redirectTo` only appears for barbers with incomplete onboarding — clients can ignore it.)*

### 1.3 `POST /auth/refresh`

- **Body:** `{ "refreshToken": "<jwt>" }`
- **Response 201:** `TokensResponseDto`.

### 1.4 `POST /auth/logout`

- **Auth:** required
- **Body:** none
- **Response 201:** `{ "success": true }`. The mobile app should also call `DELETE /device-token` before discarding the auth state.

### 1.5 `GET /auth/me`

- **Auth:** required
- **Response:** the current user's profile (client object).

### 1.6 `POST /auth/forgot-password`

- **Auth:** none
- **Body:** `{ "email": "user@example.com" }`
- **Response 201:** `{ "success": true }` (always — prevents email enumeration).

### 1.7 `POST /auth/reset-password`

- **Auth:** none
- **Body:** `{ "token": "<token_hash>", "newPassword": "NewPass1!" }`
- **Response 201:** `{ "success": true }`.

### 1.8 `PATCH /auth/change-password`

Change password while signed in. Re-authenticates with the current password before applying the new one.

- **Auth:** required
- **Body** (`ChangePasswordDto`):
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `currentPassword` | string | yes | min 8 |
  | `newPassword` | string | yes | min 8, must differ from current |
- **Response 200:** `{ "success": true }`
- Errors: `401` if `currentPassword` is wrong.

---

## 2. Profile

### 2.1 `GET /client/profile`

Returns the authenticated client's profile, billing summary, and the next upcoming booking (if any). Use this as the source for the home/profile screen.

- **Auth:** required (client)
- **Response 200** (`ClientProfileResponseDto`):
  ```ts
  {
    id: string;                                     // = auth.users.id
    name: string;
    username: string | null;
    profilePhotoUrl: string | null;
    email: string | null;
    subscriptionStatus: 'inactive' | 'active' | 'past_due' | 'cancelled';
    subscriptionExpiresAt: string | null;           // ISO timestamp
    createdAt: string;
    nextUpcomingBooking: {
      id: string;
      barberId: string;
      barberName: string;
      barberProfileImage: string | null;
      serviceName: string;
      scheduledAt: string;                          // ISO timestamp
      appointmentDate: 'YYYY-MM-DD';
      appointmentTime: 'HH:mm';
      durationMinutes: number;
      status: BookingStatus;
      isRecurring: boolean;
      recurringBookingId: string | null;
    } | null;
  }
  ```

### 2.2 `PATCH /client/profile`

Update name, username, and/or photo. Send `multipart/form-data` if uploading a photo, otherwise `application/json` works.

- **Auth:** required (client)
- **Content-Type:** `multipart/form-data` *or* `application/json`
- **Body fields** (all optional):
  | Field | Type | Notes |
  |---|---|---|
  | `photo` | file | new profile photo, max 5 MB. Replaces the previous photo. |
  | `name` | string | 1..100 |
  | `username` | string | 3..30, letters/digits/underscore only. Must be unique across clients. |
- **Response 200:** `ClientProfileResponseDto` (same shape as `GET`)
- Errors: `409` if `username` is already taken.

---

## 3. Subscriptions & Stripe Payment Flow

The client app charges a recurring **monthly** or **yearly** subscription. An active subscription unlocks booking endpoints (see "Subscription gating" in [Conventions](#conventions)).

### 3.1 How payment collection works on the device

The mobile app uses the **Stripe React Native SDK** (`@stripe/stripe-react-native`) to collect card details — **the API never receives raw card data**.

1. App initialises Stripe with the publishable key (env-specific).
2. App opens the SDK's `PaymentSheet` (or `CardField` for a custom UI). The user enters their card.
3. The SDK returns a `paymentMethodId` of the form `pm_...`.
4. The app sends this `paymentMethodId` to `POST /subscriptions` together with the chosen plan.
5. The backend attaches the PM to the Stripe customer, creates the subscription with `payment_behavior: 'default_incomplete'`, and returns:
   - `subscriptionId`
   - `status` (initially `inactive` — flips to `active` only after the webhook fires)
   - `clientSecret` (when SCA confirmation is required) or `null`.
6. **If `clientSecret` is non-null**, the app calls `confirmPayment(clientSecret, { paymentMethodType: 'Card' })` from the Stripe SDK to satisfy 3DS / SCA. Skip this step if `clientSecret` is null.
7. The app polls `GET /subscriptions/me` (or waits a few seconds and refreshes) until `status === 'active'`. The flip happens when the `customer.subscription.created` / `customer.subscription.updated` webhook lands on `POST /webhooks/stripe`.
8. Once active, the user can book.

> **Do not** treat the immediate response from `POST /subscriptions` as proof of activation. Always verify via `GET /subscriptions/me` (or by retrying the gated booking call and reacting to `SUBSCRIPTION_REQUIRED`).

### 3.2 Subscription status meanings

| Status | What it means | App should… |
|---|---|---|
| `inactive` | Never subscribed, or initial subscription not yet confirmed. | Show paywall; allow `POST /subscriptions`. |
| `active` | Paid and current. | Booking endpoints work. |
| `past_due` | Latest invoice failed. | Prompt the user to update their card via `POST /subscriptions/me/payment-method`. Stripe will retry; status auto-recovers to `active` on `invoice.payment_succeeded`. |
| `cancelled` | Period ended after a user cancellation, or Stripe removed the subscription. | Show paywall again; `POST /subscriptions` to re-subscribe. |

### 3.3 `POST /subscriptions`

Create a subscription for the authenticated client. Idempotent at the user level only in the sense that a second call replaces the previous in-flight subscription — do not call this if the user already has `active`.

- **Auth:** required (client)
- **Body** (`CreateSubscriptionDto`):
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `plan` | `'monthly' \| 'yearly'` | yes | |
  | `paymentMethodId` | string | yes | Stripe PM id (`pm_...`) returned by the Stripe SDK |
- **Response 201** (`CreateSubscriptionResponseDto`):
  ```ts
  {
    subscriptionId: string;                  // sub_...
    status: 'inactive' | 'active' | 'past_due' | 'cancelled';
    clientSecret: string | null;             // confirm with Stripe SDK if non-null
  }
  ```

### 3.4 `GET /subscriptions/me`

Read the current subscription state. Always reflects the latest webhook-mirrored state.

- **Auth:** required (client)
- **Response 200** (`SubscriptionStateResponseDto`):
  ```ts
  {
    status: 'inactive' | 'active' | 'past_due' | 'cancelled';
    plan: 'monthly' | 'yearly' | null;
    currentPeriodEnd: string | null;         // ISO timestamp — when the paid period ends
    cancelAtPeriodEnd: boolean;              // true after the user has scheduled a cancel
  }
  ```

### 3.5 `PATCH /subscriptions/me/plan`

Switch plan. **Only `monthly → yearly` is allowed.** Yearly → monthly downgrades are rejected with `409`.

- **Auth:** required (client)
- **Body** (`SwitchPlanDto`): `{ "plan": "yearly" }`
- **Response 200:** `SubscriptionStateResponseDto` (same shape as `GET`)
- Errors:
  - `400 No active subscription to switch.`
  - `409 PLAN_DOWNGRADE_NOT_ALLOWED` — already on yearly, or the request asks for monthly.

> Stripe applies a prorated invoice (`proration_behavior: 'always_invoice'`). The client's `currentPeriodEnd` updates from the `customer.subscription.updated` webhook — give it a moment after the call before re-rendering the new period.

### 3.6 `DELETE /subscriptions/me`

Cancel **at period end**. The user retains access until `currentPeriodEnd`. **No refunds**, no mid-period termination.

- **Auth:** required (client)
- **Body:** none
- **Response 200** (`CancelSubscriptionResponseDto`):
  ```ts
  {
    status: 'active';                        // still active until period_end
    cancelAtPeriodEnd: true;
    currentPeriodEnd: string | null;
  }
  ```
- Errors: `400 No active subscription to cancel.`

When `currentPeriodEnd` passes, the `customer.subscription.deleted` webhook flips status to `cancelled`.

### 3.7 `POST /subscriptions/me/payment-method`

Replace the saved card. Old card is detached from Stripe.

- **Auth:** required (client)
- **Body** (`ReplaceCardDto`): `{ "paymentMethodId": "pm_..." }`
- **Response 200** (`CardActionResponseDto`):
  ```json
  { "ok": true, "paymentMethodId": "pm_card_mastercard" }
  ```
- Use this when `subscription_status` is `past_due` to retry billing with a new card.

### 3.8 `DELETE /subscriptions/me/payment-method`

Remove the saved card. **Disallowed while a subscription or recurring arrangement is active** — cancel those first.

- **Auth:** required (client)
- **Body:** none
- **Response 200:** `{ "ok": true, "paymentMethodId": null }`
- Errors:
  - `409 ACTIVE_SUBSCRIPTION` — cancel the subscription first (or wait for it to expire).
  - `409 ACTIVE_RECURRING` — at least one recurring booking is in `pending_barber_approval`, `active`, or `paused`.

### 3.9 No-show charges (background, no client endpoint)

If a barber marks one of the client's bookings as `no_show` and has the no-show charge feature enabled (with a verified Stripe Connect account), the platform charges the client's saved card the configured USD amount via a Stripe `PaymentIntent`. The client app sees the result via:

- `GET /client/bookings/:id` → `noShowCharged: true` and `noShowChargeAmountUsd: <amount>`.
- A `booking_cancelled` push notification (the cancellation reflects the no-show transition).

The card used is the same one backing the active subscription (`stripe_payment_method_id`).

### 3.10 Webhook (server-to-server, **not** called by the app)

`POST /webhooks/stripe` is Stripe's webhook receiver. The app never calls it. Important behaviors it drives:

- `customer.subscription.created` / `.updated` → mirrors `subscription_status`, `subscription_plan`, `subscription_expires_at`, `subscription_cancel_at_period_end` onto the client row.
- `customer.subscription.deleted` → flips status to `cancelled`.
- `invoice.payment_failed` → sets status to `past_due`.
- `invoice.payment_succeeded` → if the client was `past_due`, recovers to `active`.
- `payment_intent.succeeded` / `.payment_failed` (kind=`no_show`) → updates `bookings.no_show_charged` + `no_show_charge_amount_usd`.
- `payment_method.detached` → clears `stripe_payment_method_id` on the client row.

This is why client status is **eventually consistent** — always re-fetch `GET /subscriptions/me` after a state-changing call.

---

## 4. Browse Barbers

### 4.1 `GET /client/barbers`

Paginated list of barbers, with distance, rating, recurring availability, and a few top services.

- **Auth:** required (client)
- **Query** (`ListBarbersQueryDto`):
  | Param | Type | Required | Notes |
  |---|---|---|---|
  | `latitude` | number | yes | client's current latitude |
  | `longitude` | number | yes | client's current longitude |
  | `sort` | `'nearest' \| 'top_rated'` | no | default `'nearest'` |
  | `recurring` | `'available' \| 'not_available'` | no | filter by recurring availability |
  | `search` | string | no | partial match on barber name or service name |
  | `page` | int ≥ 1 | no | default 1 |
  | `limit` | 1..50 | no | default 10 |
- **Response 200** (`ListBarbersResponseDto`):
  ```ts
  {
    barbers: [{
      id: string;                              // barber auth user id
      name: string;
      profileImage: string | null;
      averageRating: number;                   // 0 when no reviews
      totalReviews: number;
      distance: { km: number; miles: number };
      recurringAvailable: boolean;
      topServices: [{ name: string }];
    }];
    pagination: { currentPage, totalPages, totalBarbers, limit, hasNextPage };
  }
  ```

### 4.2 `GET /client/barbers/:barberId`

Barber profile screen: bio, contact, working hours, services, last 7 reviews + summary, distance.

- **Auth:** required (client)
- **Query** (`GetBarberDetailQueryDto`):
  | Param | Type | Required | Notes |
  |---|---|---|---|
  | `latitude` | number | yes | |
  | `longitude` | number | yes | |
- **Response 200** (`BarberDetailResponseDto`):
  ```ts
  {
    barber: {
      id, name,
      profileImage: string | null,
      bio: string | null,
      address: string | null,
      phone: string | null,
      workingHours: [{
        dayOfWeek: 0..6,
        isWorking: boolean,
        startTime: string | null,    // 'HH:mm'
        endTime: string | null
      }];                            // always 7 entries (Sunday → Saturday)
      recurringAvailable: boolean
    };
    services: [{
      id, name,
      serviceType: ServiceType,
      regularPrice: number,
      durationMinutes: number
    }];
    reviews: [{
      id,
      reviewerName,
      reviewerProfileImage: string | null,
      rating: 1..5,
      comment: string | null,
      createdAt
    }];                              // most recent 7
    reviewsSummary: { averageRating: number; totalReviews: number };
    distance: { km: number; miles: number };
  }
  ```

---

## 5. Availability (one-off bookings)

### 5.1 `GET /barbers/:barberId/availability`

Returns slot grids for `regular`, `afterHours`, and `dayOff` tiers across a date range. Used by the booking calendar/slot picker.

- **Auth:** required (client)
- **Path:** `barberId` (uuid).
- **Query** (`GetAvailabilityQueryDto`):
  | Param | Type | Required | Notes |
  |---|---|---|---|
  | `serviceIds` | uuid[] | yes | 1..4 service ids; can be repeated `?serviceIds=a&serviceIds=b` or comma-separated `?serviceIds=a,b`. Services are stacked back-to-back; only starts where the **full block** fits are available |
  | `startDate` | `'YYYY-MM-DD'` | yes | |
  | `endDate` | `'YYYY-MM-DD'` | yes | must be ≥ `startDate` and ≤ `startDate + 14 days` |
- **Response 200** (`AvailabilityResponseDto`):
  ```ts
  {
    barberId: string;
    services: [{
      id, name,
      durationMinutes,
      regularPrice: number,
      afterHoursPrice: number | null,
      dayOffPrice: number | null
    }];
    totalDurationMinutes: number;        // sum across all services
    days: [{
      date: 'YYYY-MM-DD',
      dayOfWeek: 0..6,
      isWorkingDay: boolean,
      slotDurationMinutes: number | null,
      slots: {
        regular:    [{ time: 'HH:mm'; endTime: 'HH:mm'; available: boolean; price: number }],
        afterHours: [{ ... }],
        dayOff:     [{ ... }]
      }
    }];
  }
  ```
  Each slot's `price` already reflects the tier (regular / after-hours / day-off). `available: false` slots are returned so the UI can render disabled rows.

---

## 6. Bookings — Preview, Confirm, Manage

The booking flow is a **two-step preview/confirm** to lock in pricing transparency before the row is created. Both `preview` and `confirm` require an active subscription — see "Subscription gating" in [Conventions](#conventions).

### 6.1 `POST /bookings/preview`

Compute the price and validate the slot, **without** creating a booking. Same payload as `confirm`. Returns HTTP `200` (not `201` — nothing was persisted).

- **Auth:** required (client)
- **Body** (`PreviewBookingDto`):
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `barberId` | uuid | yes | |
  | `services` | array, 1..4 | yes | each item: `{ "barberServiceId": uuid, "bookingType": BookingType }` |
  | `date` | `'YYYY-MM-DD'` | yes | barber's local date |
  | `slotTime` | `'HH:mm'` | yes | barber's local time. The block runs from `slotTime` for the summed duration of all selected services |
- **Response 200** (`PreviewBookingResponseDto`):
  ```ts
  {
    preview: {
      scheduledAt: string;             // ISO timestamp
      totalDurationMinutes: number;
      services: [{
        id, name,
        durationMinutes,
        bookingType: BookingType,
        startOffsetMinutes: number,    // 0 for first, then accumulates
        pricing: { basePrice, additionalCost, totalPrice }
      }];
      pricing: { basePrice, additionalCost, totalPrice };
      barber: { id, name };
    }
  }
  ```

### 6.2 `POST /bookings/confirm`

Same body as `preview`. Creates the booking row.

- **Auth:** required (client)
- **Body:** `PreviewBookingDto` (identical shape)
- **Response 201** (`ConfirmBookingResponseDto`):
  ```ts
  {
    booking: {
      id: string;
      status: 'pending' | 'confirmed';   // 'confirmed' if barber has auto-confirm on
      scheduledAt: string;
      totalDurationMinutes: number;
      services: [...same as preview...];
      pricing: { basePrice, additionalCost, totalPrice };
      barber: { id, name };
      confirmedAt: string | null;        // set when auto-confirmed
    }
  }
  ```
- Errors: `409` if the slot is no longer available (race) or violates an advance-notice rule.

### 6.3 `GET /client/bookings/upcoming`

Paginated upcoming bookings. **Recurring subscriptions collapse to their next occurrence only** (so the user sees one card per active recurring booking, not 60 days of duplicates).

- **Auth:** required (client)
- **Query** (`ClientBookingsPageQueryDto`):
  | Param | Type | Required | Notes |
  |---|---|---|---|
  | `page` | int ≥ 1 | no | default 1 |
  | `limit` | 1..50 | no | default 10 |
- **Response 200** (`ClientUpcomingBookingsResponseDto`):
  ```ts
  {
    bookings: [{
      id: string;
      barberName: string;
      barberProfileImage: string | null;
      serviceName: string;
      appointmentDate: 'YYYY-MM-DD';
      appointmentTime: 'HH:mm';
      durationMinutes: number;
      status: BookingStatus;
      isRecurring: boolean;
    }];
    pagination: { currentPage, totalPages, totalBookings, limit, hasNextPage };
  }
  ```

### 6.4 `GET /client/bookings/past`

Paginated past (completed) bookings, with a flag indicating whether the user has already left a review.

- **Auth:** required (client)
- **Query:** same as `/upcoming`.
- **Response 200** (`ClientPastBookingsResponseDto`):
  ```ts
  {
    bookings: [{
      id: string;
      barberName: string;
      barberProfileImage: string | null;
      serviceName: string;
      appointmentDate: 'YYYY-MM-DD';
      appointmentTime: 'HH:mm';
      pricePaid: number;
      hasReview: boolean;             // controls "Leave a review" button
    }];
    pagination: { currentPage, totalPages, totalBookings, limit, hasNextPage };
  }
  ```

### 6.5 `GET /client/bookings/recurring`

Page-paginated list of the client's recurring subscriptions in a UI-friendly shape (next-appointment + appointments-left).

- **Auth:** required (client)
- **Query:** same as `/upcoming`.
- **Response 200** (`ClientRecurringBookingsListResponseDto`):
  ```ts
  {
    bookings: [{
      id: string;                            // recurring booking id
      barberName: string;
      barberProfileImage: string | null;
      serviceName: string;
      nextAppointmentDate: 'YYYY-MM-DD' | null;
      appointmentTime: 'HH:mm' | null;
      durationMinutes: number;
      bookingStatus: BookingStatus | null;   // status of the next occurrence row
      recurringStatus: 'active' | 'paused' | 'pending_approval';
      appointmentsLeft: number;              // upcoming generated rows remaining
    }];
    pagination: { currentPage, totalPages, totalBookings, limit, hasNextPage };
  }
  ```

> For the **full** recurring CRUD (pause/resume/cancel/renew, detailed view with past + upcoming occurrences), use `/client/recurring-bookings/...` in [Section 7](#7-recurring-bookings).

### 6.6 `GET /client/bookings/:id`

- **Auth:** required (client)
- **Response 200** (`ClientBookingDetailResponseDto`):
  ```ts
  {
    booking: {
      id: string;
      barber: { id, name, profilePhotoUrl };
      services: [{
        id, name,
        durationMinutes,
        bookingType: BookingType,
        startOffsetMinutes: number,
        pricing: { basePrice, additionalCost, totalPrice }
      }];
      scheduledAt: string;
      totalDurationMinutes: number;
      totalPrice: number;
      status: BookingStatus;
      cancelledAt: string | null;
      cancelledBy: 'client' | 'barber' | null;
      noShowCharged: boolean;
      noShowChargeAmountUsd: number | null;
      pricing: { basePrice, additionalCost, totalPrice };
      confirmedAt: string | null;
      review: { id, rating, comment, createdAt } | null;
      isRecurring: boolean;
      recurringBookingId: string | null;
    }
  }
  ```

### 6.7 `PATCH /client/bookings/:id/cancel`

Cancel one of the user's own upcoming bookings.

- **Auth:** required (client)
- **Body:** none
- **Response 200** (`CancelBookingResponseDto`):
  ```json
  {
    "booking": {
      "id": "...",
      "status": "cancelled",
      "scheduledAt": "...",
      "cancelledAt": "...",
      "cancelledBy": "client"
    }
  }
  ```

---

## 7. Recurring Bookings

A *recurring booking* is a subscription (weekly or biweekly) at a fixed day-of-week + slot time. The flow is:

1. **Discover slots:** `GET /client/barbers/:barberId/recurring-slots` → pick a day + time + frequency.
2. **Submit offer:** `POST /client/recurring-bookings` → status becomes `pending_barber_approval`.
3. The barber accepts or declines (out of the client app's hands).
4. **Once accepted**, the system synchronously creates a 60-day rolling window of `confirmed` booking rows. The client sees them via `GET /client/bookings/upcoming` (collapsed) or `GET /client/recurring-bookings/:id` (full breakdown).

### 7.1 `GET /barbers/:barberId/services/recurring`

Client-facing list of the barber's services that **support** recurring bookings (i.e. `recurringPriceUsd` is set and at least one schedule day has `recurringEnabled = true`).

- **Auth:** required (client)
- **Response 200** (`ClientRecurringServicesResponseDto`):
  ```ts
  {
    services: [{
      id: string;
      name: string;
      serviceType: ServiceType;
      durationMinutes: number;
      regularPrice: number;
      recurringPriceFrom: number;     // lowest possible total recurring price across all recurring days
    }];
  }
  ```

### 7.2 `GET /client/barbers/:barberId/recurring-slots`

Returns the slot times that support recurring on a given day, **and** the exact recurring price + allowed frequencies.

- **Auth:** required (client)
- **Path:** `barberId` (uuid).
- **Query** (`GetRecurringSlotsQueryDto`):
  | Param | Type | Required | Notes |
  |---|---|---|---|
  | `serviceIds` | uuid[] | yes | 1..4 services, comma-separated or repeated |
  | `dayOfWeek` | int 0..6 | yes | |
- **Response 200** (`RecurringSlotsResponseDto`):
  ```ts
  {
    dayOfWeek: 0..6;
    recurringAvailable: boolean;            // false if barber/services/day disable recurring
    recurringFrequencyOptions: ('weekly' | 'biweekly')[];
    recurringPriceUsd: number | null;       // sum(service.recurringPriceUsd) + schedule.recurringExtraChargeUsd
    totalDurationMinutes: number;
    slots: [{ time: 'HH:mm'; available: boolean }];
  }
  ```

### 7.3 `POST /client/recurring-bookings`

Submit the offer. **Does not create any appointment rows yet** — only the recurring subscription with `pending_barber_approval`.

- **Auth:** required (client)
- **Body** (`CreateRecurringBookingDto`):
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `barberId` | uuid | yes | |
  | `services` | array, 1..4 | yes | each: `{ "barberServiceId": uuid, "bookingType": 'regular' \| 'day_off' }` (after_hours not allowed for recurring) |
  | `dayOfWeek` | int 0..6 | yes | |
  | `slotTime` | `'HH:mm'` | yes | |
  | `frequency` | `'weekly' \| 'biweekly'` | yes | must be in the day's `recurringFrequencyOptions` |
- **Response 201** (`RecurringBookingResponseDto`): `{ recurringBooking: RecurringBookingDto }` with `status: 'pending_barber_approval'`.

### 7.4 `GET /client/recurring-bookings`

Cursor-paginated list of the client's recurring subscriptions.

- **Auth:** required (client)
- **Query** (`ListRecurringBookingsQueryDto`):
  | Param | Type | Required | Notes |
  |---|---|---|---|
  | `status` | `RecurringStatus` | no | filter |
  | `cursor` | uuid | no | |
  | `limit` | 1..50 | no | default 20 |
- **Response 200** (`RecurringBookingsListResponseDto`):
  ```ts
  {
    recurringBookings: [{
      id, status, isRenewal,
      dayOfWeek, slotTime, frequency,
      priceUsd: number,
      service: { id, name, durationMinutes },
      barber: { id, name },
      client: { id, name },
      nextOccurrenceAt: string | null,
      createdAt: string
    }];
    nextCursor: string | null;
    hasMore: boolean;
  }
  ```

### 7.5 `GET /client/recurring-bookings/:id`

Detail with past + upcoming occurrences.

- **Auth:** required (client)
- **Response 200** (`RecurringBookingDetailResponseDto`):
  ```ts
  {
    recurringBooking: {
      id, status, isRenewal,
      originalRecurringBookingId: string | null,
      dayOfWeek, slotTime, frequency, priceUsd,
      pauseStartDate: string | null,
      pauseEndDate: string | null,
      windowStartDate: string | null,
      service: { id, name, durationMinutes },
      services: [{ id, name, durationMinutes, bookingType, startOffsetMinutes, priceUsd }],
      totalDurationMinutes: number,
      barber: { id, name },
      client: { id, name },
      createdAt,
      barberAcceptedAt: string | null,
      barberDeclinedAt: string | null,
      declinedReason: string | null,
      cancelledAt: string | null,
      cancelledBy: 'client' | 'barber' | null,
      pastOccurrences: [{ bookingId, scheduledAt, status }],
      upcomingOccurrences: [{ bookingId, scheduledAt, status }]   // capped at 8
    }
  }
  ```

### 7.6 `PATCH /client/recurring-bookings/:id/pause`

- **Auth:** required (client)
- **Body**:
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `pauseStartDate` | `'YYYY-MM-DD'` | yes | |
  | `pauseEndDate` | `'YYYY-MM-DD'` | no | omit for indefinite |
- **Response 200:** `{ recurringBooking }` (status `paused`).

### 7.7 `PATCH /client/recurring-bookings/:id/resume`

- **Auth:** required (client)
- **Body:** none
- **Response 200:** `{ recurringBooking }` (status `active`; window re-filled).

### 7.8 `PATCH /client/recurring-bookings/:id/cancel`

Cancels the subscription. Future generated rows are cancelled; past/completed rows stay.

- **Auth:** required (client)
- **Body:** none
- **Response 200:** `{ recurringBooking }` (status `cancelled`, `cancelledBy: 'client'`).

### 7.9 `POST /client/recurring-bookings/:id/renew`

Create a fresh renewal of an expiring/cancelled subscription. Settings copy over; **price re-snapshots at current rates** (the barber may have changed prices).

- **Auth:** required (client)
- **Body:** none
- **Response 201:** `{ recurringBooking }` (new id, `isRenewal: true`, `originalRecurringBookingId` populated, status `pending_barber_approval`).

---

## 8. Reviews

### 8.1 `POST /client/bookings/:bookingId/review`

Leave a review for a **completed** booking the user owns.

- **Auth:** required (client)
- **Body** (`CreateReviewDto`):
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `rating` | int 1..5 | yes | |
  | `comment` | string | no | max 1000 |
- **Response 201** (`CreateReviewResponseDto`):
  ```ts
  {
    review: {
      id: string;
      bookingId: string;
      rating: number;
      comment: string | null;
      createdAt: string;
    }
  }
  ```
- Errors: `403` if the booking is not the caller's; `409` if the booking is not `completed` or already has a review.

### 8.2 `GET /client/barbers/:barberId/reviews`

Cursor-paginated reviews for a barber. Supports filtering by exact star rating.

- **Auth:** required (client)
- **Query** (`ListReviewsQueryDto`):
  | Param | Type | Required | Notes |
  |---|---|---|---|
  | `cursor` | uuid | no | |
  | `limit` | 1..50 | no | default 20 |
  | `rating` | int 1..5 | no | when set, only reviews with this exact star count are returned |
- **Response 200** (`ReviewsListResponseDto`):
  ```ts
  {
    barber: { id, name, averageRating: number | null, totalReviews };  // unfiltered totals
    reviews: [{
      id,
      client: { name, profilePhotoUrl },
      rating,
      comment: string | null,
      relativeTime: string,         // e.g. "2 weeks ago"
      createdAt: string
    }];
    nextCursor: string | null;
    hasMore: boolean;
  }
  ```

> `barber.averageRating` and `barber.totalReviews` are computed across **all** reviews and don't change when `rating` is set. Only the `reviews` array is filtered.

---

## 9. Conversations / Messaging

Both clients and barbers use `/conversations`. **Clients cannot start a thread** — only the barber can (`POST /conversations/start`). The client app should hide any "New chat" CTA but display threads the barber starts.

### 9.1 `GET /conversations`

- **Auth:** required (client)
- **Query** (`ListConversationsQueryDto`):
  | Param | Type | Required | Notes |
  |---|---|---|---|
  | `page` | int ≥ 1 | no | default 1 |
  | `limit` | 1..100 | no | default 20 |
  | `search` | string | no | partial match on barber name |
- **Response 200** (`ListConversationsResponseDto`):
  ```ts
  {
    conversations: [{
      id: string;
      otherParty: { id, name, profilePhotoUrl };   // the barber, from the client's POV
      lastMessageBody: string | null;
      lastMessageAt: string | null;
      lastMessageSenderRole: 'barber' | 'client' | null;
      unreadCount: number;
      hasBooking: boolean;
      createdAt: string;
    }];
    pagination: { currentPage, totalPages, totalConversations, limit, hasNextPage };
  }
  ```

### 9.2 `GET /conversations/:id/messages`

Cursor-paginated history. **Marks counterparty messages as read.**

- **Auth:** required (client)
- **Query** (`ListMessagesQueryDto`):
  | Param | Type | Required | Notes |
  |---|---|---|---|
  | `before` | uuid | no | cursor (message id); returns rows strictly older than this |
  | `limit` | 1..100 | no | default 30 |
- **Response 200** (`ListMessagesResponseDto`) — messages are returned **ascending** by `createdAt` (oldest first), so older pages prepend to the top:
  ```ts
  {
    messages: [{
      id, conversationId,
      senderRole: 'barber' | 'client',
      body: string,
      readAt: string | null,
      createdAt: string
    }];
    hasMore: boolean;
    nextCursor: string | null;
  }
  ```

### 9.3 `POST /conversations/:id/messages`

- **Auth:** required (client)
- **Body:** `{ "body": "string (1..1000)" }`
- **Response 201:** `{ "message": MessageDto }`

> **Realtime:** Subscribe to Supabase Realtime on the `messages` table filtered by `conversation_id` for live updates.

---

## 10. Push Notifications

### 10.1 `POST /device-token`

Register or refresh the user's Expo / FCM push token. Upserts on `(user_id, platform)`.

- **Auth:** required (client)
- **Body** (`RegisterDeviceTokenDto`):
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `token` | string | yes | `ExponentPushToken[…]` or FCM token, max 512 |
  | `platform` | `'ios' \| 'android'` | yes | |
- **Response 200:** `{ "id": "<row id>", "token": "<token>", "platform": "ios" }`

### 10.2 `DELETE /device-token`

Call on logout.

- **Auth:** required (client)
- **Body:** `{ "token": "<token>" }`
- **Response 200:** `{ "removed": true }`

### 10.3 `GET /client/notifications`

Page-paginated, newest first.

- **Auth:** required (client)
- **Query** (`ListNotificationsQueryDto`):
  | Param | Type | Required | Notes |
  |---|---|---|---|
  | `page` | int ≥ 1 | no | default 1 |
  | `limit` | 1..100 | no | default 20 |
- **Response 200** (`ListNotificationsResponseDto`):
  ```ts
  {
    notifications: [{
      id: string;
      type: NotificationType;
      title: string;
      body: string;
      data: Record<string, unknown>;          // freeform, used for deep linking
      isRead: boolean;
      bookingId: string | null;
      recurringBookingId: string | null;
      conversationId: string | null;
      messageId: string | null;
      createdAt: string;
    }];
    pagination: { currentPage, totalPages, totalNotifications, limit, hasNextPage };
  }
  ```
  Notification types relevant to clients: `booking_confirmed`, `booking_cancelled`, `recurring_accepted`, `recurring_refused`, `recurring_expiring`, `new_message`. Use the populated id field (`bookingId` / `recurringBookingId` / `conversationId` + `messageId`) to deep-link.

### 10.4 `GET /client/notifications/unread-count`

- **Auth:** required (client)
- **Response 200:** `{ "unreadCount": 3 }`

### 10.5 `PUT /client/notifications/:notificationId/read`

- **Auth:** required (client)
- **Body:** none
- **Response 200:** `{ "id": "<id>", "isRead": true }`

> The client app does **not** have notification preference toggles — those live on the barber side only. Clients receive the full set of client-targeted notifications.

---

## Common Error Codes

| Status | Meaning | Typical cause |
|---|---|---|
| 400 | Validation error | missing/malformed field; `endDate > startDate + 14d` on availability; `services` array empty or > 4 items |
| 401 | Unauthorized | missing/expired access token; refresh and retry |
| 403 | Forbidden | wrong role (e.g. trying to start a conversation as a client), accessing another user's resource, **or** `SUBSCRIPTION_REQUIRED` on a gated booking call |
| 404 | Not found | bad id, or it belongs to another user |
| 409 | Conflict | slot already taken (race), advance-notice rule violated, illegal state transition (e.g. cancelling a `completed` booking, reviewing a non-completed booking, double review on the same booking), `PLAN_DOWNGRADE_NOT_ALLOWED`, `ACTIVE_SUBSCRIPTION`, `ACTIVE_RECURRING` |
| 500 | Server error | log + retry |

The mobile app should treat `401` as a signal to call `POST /auth/refresh` once and retry; if refresh also returns `401`, log the user out.

Common application error codes (`code` field in the error envelope):
- `SUBSCRIPTION_REQUIRED` (403) — booking endpoint hit without an `active` subscription. Route to the paywall (Section 3).
- `PLAN_DOWNGRADE_NOT_ALLOWED` (409) — `PATCH /subscriptions/me/plan` rejected (only monthly→yearly is allowed).
- `ACTIVE_SUBSCRIPTION` (409) — `DELETE /subscriptions/me/payment-method` rejected because a subscription is still active.
- `ACTIVE_RECURRING` (409) — same endpoint, but rejected because of an active/pending/paused recurring booking.

---

## End-to-End Booking Flow (cheat sheet)

**Subscription gate (run once before any booking action):**
1. After login, call `GET /subscriptions/me`.
2. If `status !== 'active'`:
   - Collect a card via the Stripe React Native SDK → get `paymentMethodId`.
   - `POST /subscriptions` with the chosen `plan` and `paymentMethodId`.
   - If response has `clientSecret`, call `confirmPayment(clientSecret)` from the Stripe SDK to satisfy SCA.
   - Poll `GET /subscriptions/me` until `status === 'active'`.

**One-off booking:**
1. `GET /client/barbers?latitude=…&longitude=…` → list view
2. `GET /client/barbers/:barberId?latitude=…&longitude=…` → profile + services
3. User picks 1–4 services → call `GET /barbers/:barberId/availability?serviceIds=…&startDate=…&endDate=…`
4. User picks a slot → `POST /bookings/preview` to show breakdown
5. User taps Confirm → `POST /bookings/confirm` → booking created (`pending` until barber confirms, or `confirmed` if auto-confirm is on)
6. Show in `GET /client/bookings/upcoming`
7. After completion → `GET /client/bookings/past` → optional `POST /client/bookings/:id/review`

**Recurring booking:**
1. `GET /client/barbers?recurring=available` → barbers that support recurring
2. `GET /barbers/:barberId/services/recurring` → recurring-eligible services
3. User picks day → `GET /client/barbers/:barberId/recurring-slots?serviceIds=…&dayOfWeek=…`
4. User picks time + frequency → `POST /client/recurring-bookings` (status: `pending_barber_approval`)
5. Barber accepts (out of band) → `recurring_accepted` push notification
6. Show on `GET /client/bookings/recurring` and `GET /client/recurring-bookings/:id`
7. User can `PATCH .../pause`, `.../resume`, `.../cancel`, or `POST .../renew` from the detail screen

---

## Quick Endpoint Index (Client)

| Group | Method | Path |
|---|---|---|
| Auth | POST | `/auth/client/register` |
| Auth | POST | `/auth/login` |
| Auth | POST | `/auth/refresh` |
| Auth | POST | `/auth/logout` |
| Auth | GET | `/auth/me` |
| Auth | POST | `/auth/forgot-password` |
| Auth | POST | `/auth/reset-password` |
| Auth | PATCH | `/auth/change-password` |
| Profile | GET | `/client/profile` |
| Profile | PATCH | `/client/profile` |
| Subscriptions | POST | `/subscriptions` |
| Subscriptions | GET | `/subscriptions/me` |
| Subscriptions | PATCH | `/subscriptions/me/plan` |
| Subscriptions | DELETE | `/subscriptions/me` |
| Subscriptions | POST | `/subscriptions/me/payment-method` |
| Subscriptions | DELETE | `/subscriptions/me/payment-method` |
| Browse | GET | `/client/barbers` |
| Browse | GET | `/client/barbers/:barberId` |
| Browse | GET | `/barbers/:barberId/services/recurring` |
| Availability | GET | `/barbers/:barberId/availability` |
| Recurring slots | GET | `/client/barbers/:barberId/recurring-slots` |
| Bookings | POST | `/bookings/preview` |
| Bookings | POST | `/bookings/confirm` |
| Bookings | GET | `/client/bookings/upcoming` |
| Bookings | GET | `/client/bookings/past` |
| Bookings | GET | `/client/bookings/recurring` |
| Bookings | GET | `/client/bookings/:id` |
| Bookings | PATCH | `/client/bookings/:id/cancel` |
| Recurring | GET | `/client/recurring-bookings` |
| Recurring | POST | `/client/recurring-bookings` |
| Recurring | GET | `/client/recurring-bookings/:id` |
| Recurring | PATCH | `/client/recurring-bookings/:id/pause` |
| Recurring | PATCH | `/client/recurring-bookings/:id/resume` |
| Recurring | PATCH | `/client/recurring-bookings/:id/cancel` |
| Recurring | POST | `/client/recurring-bookings/:id/renew` |
| Reviews | POST | `/client/bookings/:bookingId/review` |
| Reviews | GET | `/client/barbers/:barberId/reviews` |
| Messages | GET | `/conversations` |
| Messages | GET | `/conversations/:id/messages` |
| Messages | POST | `/conversations/:id/messages` |
| Push | POST | `/device-token` |
| Push | DELETE | `/device-token` |
| Notifications | GET | `/client/notifications` |
| Notifications | GET | `/client/notifications/unread-count` |
| Notifications | PUT | `/client/notifications/:notificationId/read` |
