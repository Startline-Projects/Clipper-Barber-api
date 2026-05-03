# Barber API Reference

Target audience: the mobile **barber app** (developers integrating the React Native / Expo barber-side client).

This document covers every endpoint a barber user hits — from onboarding through day-to-day operations: managing services, schedule, bookings, recurring subscriptions, reviews, conversations, and notifications.

---

## Table of Contents

1. [Conventions](#conventions)
2. [Shared Enums](#shared-enums)
3. [Auth & Onboarding](#1-auth--onboarding)
4. [Profile & Home Dashboard](#2-profile)
5. [Services](#3-services)
6. [Schedule](#4-schedule)
7. [Settings](#5-settings)
8. [Bookings (one-off)](#6-bookings-one-off)
9. [Recurring Bookings](#7-recurring-bookings)
10. [My Clients](#8-my-clients)
11. [Reviews](#9-reviews)
12. [Conversations / Messaging](#10-conversations--messaging)
13. [Push Notifications](#11-push-notifications)
14. [Notification Settings](#12-notification-settings)
15. [Analytics](#13-analytics)
16. [Stripe Connect & No-Show Charges](#14-stripe-connect--no-show-charges)
17. [Common Error Codes](#common-error-codes)

---

## Conventions

- **Base URL:** `http://localhost:3000` (dev). Production URL is environment-specific. Swagger UI is exposed at `/api/docs` outside production.
- **Auth header:** `Authorization: Bearer <accessToken>` on every endpoint marked **Auth: required**. Tokens are issued by Supabase Auth.
- **Role gating:** Endpoints under `role: barber` reject other roles with HTTP `403`. The role is read from the JWT `user_metadata.role` claim, so the mobile app does **not** send the role on protected calls — only on `POST /auth/login`.
- **Content type:** `application/json` for everything *except* `POST /auth/barber/step3` which uses `multipart/form-data`.
- **Date / time format:**
  - Calendar dates: `YYYY-MM-DD` (in the barber's local timezone).
  - Times of day: `HH:mm` (24-hour, in the barber's local timezone).
  - Timestamps (`createdAt`, `scheduledAt`, etc.): ISO 8601 UTC, e.g. `2026-04-25T14:30:00.000Z`.
- **`dayOfWeek`** is `0..6` where `0 = Sunday` and `6 = Saturday`.
- **Validation:** A global `ValidationPipe` strips unknown fields and rejects extras with `400`. Always send keys exactly as documented.
- **Error shape (global filter):**
  ```json
  { "error": true, "message": "Human-readable message", "code": "OPTIONAL_CODE" }
  ```
  - `400` validation, `401` auth missing/invalid, `403` role mismatch, `404` not found, `409` conflict (e.g. double booking, unique violation), `500` server error.
- **Pagination:**
  - **Cursor-based** (bookings, recurring bookings, reviews, messages): pass `cursor=<id-of-last-item-from-previous-page>`. Response returns `nextCursor` + `hasMore`. `limit` default `20`, max `50`.
  - **Page-based** (notifications, conversations): pass `page=<n>` & `limit=<n>`. Response returns `pagination.{currentPage, totalPages, hasNextPage, ...}`. `limit` default `20`, max `100`.
- **Stripe Connect deep links:** the Stripe-hosted onboarding page redirects to `APP_URL_BARBER/connect/return` on success and `APP_URL_BARBER/connect/refresh` if the link expired. Configure these as deep links in the Expo app and route both into a single "refresh status" screen that re-calls `GET /barbers/me/connect/status`.

---

## Shared Enums

```ts
// Service types
ServiceType         = 'haircut' | 'beard' | 'haircut_beard' | 'eyebrows' | 'other'

// Booking pricing tier
BookingType         = 'regular' | 'after_hours' | 'day_off'

// Booking lifecycle
BookingStatus       = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'

// List filters
BookingTimeframe    = 'upcoming' | 'past'
BookingTypeFilter   = 'one_off' | 'recurring'

// Service / slot durations (minutes)
DurationMinutes     = 15 | 30 | 45 | 60

// Recurring
RecurringFrequency      = 'weekly' | 'biweekly'                  // chosen on a subscription
RecurringFrequencyOption = 'weekly' | 'biweekly' | 'both'        // configured on a schedule day
RecurringStatus     = 'pending_barber_approval' | 'active' | 'paused' | 'cancelled' | 'expired'

// Other
CancelledBy         = 'client' | 'barber'
DevicePlatform      = 'ios' | 'android'

// Notification types pushed to the barber:
NotificationType    =
    | 'new_booking'
    | 'cancelled_booking'
    | 'new_recurring_request'
    | 'recurring_cancelled'
    | 'recurring_paused'
    | 'new_message'
    // The next ones target the client side, listed for completeness:
    | 'booking_confirmed'
    | 'booking_cancelled'
    | 'recurring_accepted'
    | 'recurring_refused'
    | 'recurring_expiring'
```

---

## 1. Auth & Onboarding

Barber onboarding is a 3-step flow. Steps 2 and 3 require the access token issued by step 1.

### 1.1 `POST /auth/barber/step1`

Create the auth account.

- **Auth:** none
- **Body:**
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `fullName` | string | yes | max 100 |
  | `email` | string | yes | valid email |
  | `password` | string | yes | min 8 chars |
- **Response 201** `TokensResponseDto`:
  ```json
  { "accessToken": "<jwt>", "refreshToken": "<jwt>" }
  ```

### 1.2 `POST /auth/barber/step2`

Save shop info (used for discovery + maps).

- **Auth:** required (barber role)
- **Body:**
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `shopName` | string | yes | max 100 |
  | `phone` | string | yes | regex `^[+\d\s\-()]+$` |
  | `streetAddress` | string | yes | max 200 |
  | `city` | string | yes | max 100 |
  | `state` | string | yes | max 50 |
  | `zipCode` | string | yes | `12345` or `12345-6789` |
  | `latitude` | number | yes | `-90..90` |
  | `longitude` | number | yes | `-180..180` |
- **Response 201:** `{ "success": true }`

### 1.3 `POST /auth/barber/step3`

Optional bio + photo. **Marks onboarding complete.**

- **Auth:** required (barber role)
- **Content-Type:** `multipart/form-data`
- **Body fields:**
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `photo` | file | no | profile photo, max 5 MB |
  | `bio` | string | no | max 500 |
  | `instagramHandle` | string | no | letters/numbers/`._` only, no `@` |
- **Response 201:** `BarberProfileResponseDto` (see [Profile](#2-profile)).

### 1.4 `POST /auth/login`

- **Auth:** none
- **Body:**
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `email` | string | yes | |
  | `password` | string | yes | min 8 |
  | `role` | `'barber' \| 'client'` | yes | sent by the app, not the user |
- **Response 201** `LoginResponseDto`:
  ```json
  {
    "accessToken": "<jwt>",
    "refreshToken": "<jwt>",
    "id": "<user-uuid>",
    "email": "barber@example.com",
    "username": "John Doe",
    "redirectTo": "barber/step2"   // ONLY when onboarding is incomplete
  }
  ```
  If `redirectTo` is present, route the user back into onboarding at that step instead of the home screen.

### 1.5 `POST /auth/refresh`

- **Body:** `{ "refreshToken": "<jwt>" }`
- **Response 201:** `TokensResponseDto`.

### 1.6 `POST /auth/logout`

- **Auth:** required
- **Body:** none
- **Response 201:** `{ "success": true }`. Server-side session invalidated. The mobile app should also call `DELETE /device-token` to remove the push token.

### 1.7 `GET /auth/me`

- **Auth:** required
- **Response:** Returns `BarberProfileResponseDto` for barbers, the client profile object for clients.

### 1.8 `POST /auth/forgot-password`

- **Auth:** none
- **Body:** `{ "email": "user@example.com" }`
- **Response 201:** `{ "success": true }` (always success — prevents email enumeration).

### 1.9 `POST /auth/reset-password`

- **Auth:** none
- **Body:**
  ```json
  { "token": "<token_hash from email link>", "newPassword": "NewSecurePass1!" }
  ```
- **Response 201:** `{ "success": true }`.

### 1.10 `PATCH /auth/change-password`

Change password while signed in (re-authenticates with the current password before applying the new one).

- **Auth:** required
- **Body** (`ChangePasswordDto`):
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `currentPassword` | string | yes | min 8 |
  | `newPassword` | string | yes | min 8, must differ |
- **Response 200:** `{ "success": true }`
- Errors: `401` if `currentPassword` is wrong.

---

## 2. Profile

`BarberProfileResponseDto` is returned from `/auth/barber/step3`, `/auth/me`, `GET /barber/profile`, and `PATCH /barber/profile`.

```ts
{
  id: string;                     // = auth.users.id
  full_name: string;
  shop_name: string;
  phone?: string;
  street_address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  latitude?: number;
  longitude?: number;
  bio?: string;
  instagram_handle?: string;
  profile_photo_url?: string;
  onboarding_step: number;        // 1 | 2 | 3
  onboarding_complete: boolean;
  created_at: string;             // ISO timestamp
}
```

> **Note:** Profile fields use `snake_case` here (this DTO surfaces the row directly). All other DTOs in this API use `camelCase`.

### 2.1 `GET /barber/profile`

Read the authenticated barber's full profile (same shape as `/auth/me` for barbers — kept as a dedicated endpoint so the mobile app can fetch the profile without going through the role-discriminated `/auth/me`).

- **Auth:** required (barber)
- **Response 200:** `BarberProfileResponseDto`

### 2.2 `PATCH /barber/profile`

Update any subset of profile fields. Send `multipart/form-data` if uploading a photo, otherwise `application/json` is accepted.

- **Auth:** required (barber)
- **Content-Type:** `multipart/form-data` *or* `application/json`
- **Body fields** (all optional):
  | Field | Type | Notes |
  |---|---|---|
  | `photo` | file | new profile photo, max 5 MB. Replaces the previous photo. |
  | `fullName` | string | max 100 |
  | `shopName` | string | max 100 |
  | `phone` | string | regex `^[+\d\s\-()]+$` |
  | `streetAddress` | string | max 200 |
  | `city` | string | max 100 |
  | `state` | string | max 50 |
  | `zipCode` | string | `12345` or `12345-6789` |
  | `latitude` | number | `-90..90` |
  | `longitude` | number | `-180..180` |
  | `bio` | string | max 500 |
  | `instagramHandle` | string | letters/numbers/`._` only, no `@` |
- **Response 200:** `BarberProfileResponseDto`

### 2.3 `GET /barber/home`

Single-call **home dashboard** payload: today's counts and earnings, the pending-approval queue, the next confirmed appointments, plus the relevant settings flags so the dashboard can render without a second round-trip.

- **Auth:** required (barber)
- **Query** (`GetBarberHomeQueryDto`):
  | Param | Type | Required | Notes |
  |---|---|---|---|
  | `tz` | string | no | IANA timezone override (e.g. `Africa/Cairo`). Falls back to the barber profile timezone if omitted, then to UTC. Max 64 chars. |
- **Response 200** (`BarberHomeResponseDto`):
  ```ts
  {
    today: {
      date: 'YYYY-MM-DD';                  // calendar date in the resolved timezone
      timezone: string;                    // resolved IANA timezone, e.g. 'Africa/Cairo'
      totalAppointments: number;           // bookings starting today, excluding cancelled
      completedCount: number;
      remainingCount: number;              // status confirmed/pending AND end_at > now()
      earningsSoFarUsd: number;            // SUM(price_usd) over completed bookings starting today
    };
    pendingApproval: {
      totalCount: number;                  // full count, NOT capped at items.length
      items: [{
        bookingId: string;
        client: { id: string; fullName: string; profilePhotoUrl: string | null };
        service: { id: string; name: string } | null;
        scheduledAt: string;               // ISO timestamp
        priceUsd: number;
        status: BookingStatus;             // typically 'pending'
        requestedAt: string;               // ISO timestamp (booking createdAt)
      }];
    };
    schedule: {
      totalUpcomingToday: number;          // full count of confirmed bookings remaining today
      items: [{
        bookingId: string;
        client: { id: string; fullName: string; profilePhotoUrl: string | null };
        service: { id: string; name: string; durationMinutes: number } | null;
        scheduledAt: string;               // ISO timestamp
        endAt: string;                     // ISO timestamp = scheduledAt + duration
        minutesUntilStart: number;         // whole minutes from server now() until scheduledAt — re-derive client-side from scheduledAt for live ticking
        priceUsd: number;
        status: BookingStatus;             // typically 'confirmed'
      }];
    };
    allowAutoConfirm: boolean;
    autoConfirmToday: boolean;
    recurringEnabled: boolean;
    noShowChargeEnabled: boolean;
    noShowChargeAmountUsd: number | null;
  }
  ```

> The two `items` arrays are capped server-side; use `pendingApproval.totalCount` and `schedule.totalUpcomingToday` as the source of truth for "X more pending" / "Y more today" UI affordances and route the user to the full lists (`GET /barber/recurring-bookings?status=pending_barber_approval` for pending recurring offers, `GET /barber/bookings?timeframe=upcoming` for the schedule) when they tap through.

---

## 3. Services

A barber configures services (haircut, beard, etc.) with prices for each booking tier. All routes are scoped under `:barberId` — clients pass the barber's id; the barber pass their own id (the service still authorises against the JWT).

### 3.1 `POST /barbers/:barberId/services`

Create a service.

- **Auth:** required (barber)
- **Body** (`CreateBarberServiceDto`):
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `name` | string | yes | max 100, e.g. `"Skin Fade"` |
  | `serviceType` | `ServiceType` | yes | enum |
  | `durationMinutes` | `15 \| 30 \| 45 \| 60` | yes | |
  | `regularPriceUsd` | number | yes | base price |
  | `afterHoursPriceUsd` | number | no | enables after-hours bookings for this service |
  | `dayOffPriceUsd` | number | no | enables day-off bookings |
  | `recurringPriceUsd` | number | no | per-occurrence price; **null/omit ⇒ this service is NOT bookable as recurring** |
- **Response 201:**
  ```ts
  { success: true, data: BarberServiceDto }
  ```

`BarberServiceDto`:
```ts
{
  id: string;
  barberId: string;
  name: string;
  serviceType: ServiceType;
  durationMinutes: number;
  regularPriceUsd: number;
  afterHoursPriceUsd: number | null;
  dayOffPriceUsd: number | null;
  recurringPriceUsd: number | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
```

### 3.2 `GET /barbers/:barberId/services`

List **all** services (active and inactive).

- **Auth:** required (barber)
- **Response 200:** `{ success: true, data: BarberServiceDto[] }`

### 3.3 `GET /barbers/:barberId/services/:serviceId`

- **Auth:** required (barber)
- **Response 200:** `{ success: true, data: BarberServiceDto }`

### 3.4 `PATCH /barbers/:barberId/services/:serviceId`

Partial update.

- **Auth:** required (barber)
- **Body** (`UpdateBarberServiceDto`) — all fields optional:
  - `name`, `serviceType`, `durationMinutes`, `regularPriceUsd`
  - `afterHoursPriceUsd | null`, `dayOffPriceUsd | null`, `recurringPriceUsd | null` — **pass `null` to clear** (e.g. disable recurring on a service)
  - `sortOrder`
- **Response 200:** `{ success: true, data: BarberServiceDto }`

### 3.5 `PATCH /barbers/:barberId/services/:serviceId/toggle`

Flip `is_active`.

- **Auth:** required (barber)
- **Body:** none
- **Response 200:** `{ success: true, data: BarberServiceDto }`

### 3.6 `PATCH /barbers/:barberId/services/reorder`

Bulk reorder. The first id gets `sort_order = 0`, second gets `1`, etc.

- **Auth:** required (barber)
- **Body:** `{ "serviceIds": ["uuid-1", "uuid-2", "uuid-3"] }`
- **Response 200:** `{ success: true, data: BarberServiceDto[] }` — full list, in the new order.

---

## 4. Schedule

Each barber has 7 schedule rows (Sunday=0 … Saturday=6). The barber edits one day at a time.

### 4.1 `GET /schedule`

Returns all 7 days for the authenticated barber.

- **Auth:** required (barber)
- **Response 200:** `{ success: true, data: ScheduleDayDto[] }` (7 items)

`ScheduleDayDto`:
```ts
{
  id: string;
  barberId: string;
  dayOfWeek: number;                    // 0..6
  isWorking: boolean;
  regularStartTime: string | null;      // 'HH:mm'
  regularEndTime: string | null;
  slotDurationMinutes: number;          // 15 | 30 | 45 | 60
  afterHoursEnabled: boolean;
  afterHoursStart: string | null;
  afterHoursEnd: string | null;
  dayOffBookingEnabled: boolean;
  dayOffStartTime: string | null;
  dayOffEndTime: string | null;
  advanceNoticeMinutes: number;         // ≥ 0
  recurringEnabled: boolean;
  recurringFrequency: 'weekly' | 'biweekly' | 'both' | null;
  recurringExtraChargeUsd: number | null;  // flat surcharge added on top of service.recurringPriceUsd
  createdAt: string;
  updatedAt: string;
}
```

### 4.2 `PATCH /schedule/:dayOfWeek`

Partial update of one day.

- **Auth:** required (barber)
- **Path:** `dayOfWeek` integer `0..6`.
- **Body** (`UpdateScheduleDayDto`) — all fields optional:
  - `isWorking: boolean`
  - `regularStartTime: 'HH:mm'`, `regularEndTime: 'HH:mm'`
  - `slotDurationMinutes: 15 | 30 | 45 | 60`
  - `afterHoursEnabled: boolean`, `afterHoursStart: 'HH:mm'`, `afterHoursEnd: 'HH:mm'`
  - `dayOffBookingEnabled: boolean`, `dayOffStartTime: 'HH:mm'`, `dayOffEndTime: 'HH:mm'`
  - `advanceNoticeMinutes: number ≥ 0`
  - `recurringEnabled: boolean`
  - `recurringFrequency: 'weekly' | 'biweekly' | 'both'` — **required when** `recurringEnabled = true`
  - `recurringExtraChargeUsd: number ≥ 0` — flat surcharge per occurrence on this day
- **Response 200:** `{ success: true, data: ScheduleDayDto }`

---

## 5. Settings

Three independent toggles live under `/barber/settings/`. Each returns a structured response — read it back into your local store rather than assuming the `body.enabled` you sent.

### 5.1 `PATCH /barber/settings/auto-confirm`

Toggle global auto-confirm for **all** incoming bookings.

- **Auth:** required (barber)
- **Body:** `{ "enabled": true }`
- **Response 200:** `{ "allowAutoConfirm": boolean, "autoConfirmToday": boolean }`

### 5.2 `PATCH /barber/settings/auto-confirm-today`

Toggle auto-confirm only for **same-day** bookings (lower-stakes opt-in).

- **Auth:** required (barber)
- **Body:** `{ "enabled": true }`
- **Response 200:** `{ "allowAutoConfirm": boolean, "autoConfirmToday": boolean }`

### 5.3 `PATCH /barber/settings/recurring`

Master switch for recurring availability across the barber's profile (independent of per-day `recurringEnabled`).

- **Auth:** required (barber)
- **Body:** `{ "enabled": true }`
- **Response 200:** `{ "recurringEnabled": boolean }`

### 5.4 `PATCH /barber/settings/no-show-charge`

Toggle the no-show charge feature and/or set its USD amount. **Requires a Stripe Connect account whose `charges_enabled` is `true`** — see [Section 13](#13-stripe-connect--no-show-charges).

- **Auth:** required (barber)
- **Body** (`UpdateNoShowChargeDto`):
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `enabled` | boolean | yes | |
  | `amountUsd` | number ≥ 0 | required when `enabled = true` | flat USD amount charged to the client's saved card on no-show |
- **Response 200:** `{ "enabled": boolean, "amountUsd": number | null }`
- Errors: `409 CONNECT_REQUIRED` when enabling without a Connect account in `charges_enabled = true` state.

---

## 6. Bookings (one-off)

### 6.1 `GET /barber/bookings`

Cursor-paginated list of the barber's bookings.

- **Auth:** required (barber)
- **Query** (`ListBarberBookingsQueryDto`):
  | Param | Type | Required | Notes |
  |---|---|---|---|
  | `timeframe` | `'upcoming' \| 'past'` | yes | |
  | `bookingType` | `BookingType` | no | filter on regular / after_hours / day_off |
  | `status` | `BookingStatus` | no | |
  | `type` | `'one_off' \| 'recurring'` | no | `recurring` = bookings spawned from a subscription |
  | `cursor` | uuid | no | `id` of the last item on the previous page |
  | `limit` | int 1..50 | no | default 20 |
- **Response 200** (`BarberBookingsListResponseDto`):
  ```ts
  {
    bookings: [{
      id: string;
      client: { id: string; name: string; profilePhotoUrl: string | null };
      service: { name: string; durationMinutes: number };
      scheduledAt: string;             // ISO timestamp
      bookingType: BookingType;
      totalPrice: number;
      status: BookingStatus;
      isRecurring: boolean;
      recurringBookingId: string | null;
      createdAt: string;
    }];
    nextCursor: string | null;
    hasMore: boolean;
  }
  ```

### 6.2 `GET /barber/bookings/:id`

- **Auth:** required (barber)
- **Response 200** (`BarberBookingDetailResponseDto`):
  ```ts
  {
    booking: {
      id: string;
      client: { id, name, profilePhotoUrl };
      service: { name, durationMinutes };
      scheduledAt: string;
      bookingType: BookingType;
      status: BookingStatus;
      pricing: { basePrice: number; additionalCost: number; totalPrice: number };
      confirmedAt: string | null;
      cancelledAt: string | null;
      cancelledBy: 'client' | 'barber' | null;
      noShowCharged: boolean;
      noShowChargeAmountUsd: number | null;
      reviewLeftByClient: boolean;
      isRecurring: boolean;
      recurringBookingId: string | null;
      createdAt: string;
    }
  }
  ```

### 6.3 `PATCH /barber/bookings/:id/confirm`

Manually confirm a `pending` booking.

- **Auth:** required (barber)
- **Body:** none
- **Response 200:** `{ "booking": { "id", "status": "confirmed", "confirmedAt": "<iso>" } }`
- Errors: `409` if status is not `pending`.

### 6.4 `PATCH /barber/bookings/:id/cancel`

Cancel any booking in `pending` or `confirmed`.

- **Auth:** required (barber)
- **Body:** none
- **Response 200:** `{ "booking": { "id", "status": "cancelled", "cancelledAt": "<iso>", "cancelledBy": "barber" } }`

### 6.5 `PATCH /barber/bookings/:id/complete`

Mark a `confirmed` booking as completed (after the appointment).

- **Auth:** required (barber)
- **Body:** none
- **Response 200:** `{ "booking": { "id", "status": "completed" } }`

### 6.6 `PATCH /barber/bookings/:id/no-show`

Mark a booking as no-show **after the appointment window ends**.

- **Auth:** required (barber)
- **Body:** none
- **Response 200:** `{ "booking": { "id", "status": "no_show" } }`

---

## 7. Recurring Bookings

A *recurring booking* is a subscription (weekly or biweekly) at a fixed day-of-week + slot time. The client requests it; the barber accepts/declines. Once accepted, the system synchronously generates a 60-day rolling window of confirmed appointments.

### 7.1 `GET /barber/recurring-bookings`

Cursor-paginated list. Pending offers appear here with `status = 'pending_barber_approval'`.

- **Auth:** required (barber)
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
      id: string;
      status: RecurringStatus;
      isRenewal: boolean;
      dayOfWeek: number;             // 0..6
      slotTime: string;              // 'HH:mm'
      frequency: 'weekly' | 'biweekly';
      priceUsd: number;
      service: { id, name, durationMinutes };
      barber: { id, name };
      client: { id, name };
      nextOccurrenceAt: string | null;  // ISO
      createdAt: string;
    }];
    nextCursor: string | null;
    hasMore: boolean;
  }
  ```

### 7.2 `GET /barber/recurring-bookings/:id`

- **Auth:** required (barber)
- **Response 200** (`RecurringBookingDetailResponseDto`):
  ```ts
  {
    recurringBooking: {
      ...RecurringBookingDto,        // see /barber/recurring-bookings list shape (extended)
      services: [{ id, name, durationMinutes, bookingType, startOffsetMinutes, priceUsd }],
      totalDurationMinutes: number,
      pastOccurrences: [{ bookingId, scheduledAt, status }],
      upcomingOccurrences: [{ bookingId, scheduledAt, status }],   // capped at 8
      windowStartDate: string | null,
      pauseStartDate: string | null,
      pauseEndDate: string | null,
      barberAcceptedAt: string | null,
      barberDeclinedAt: string | null,
      declinedReason: string | null,
      cancelledAt: string | null,
      cancelledBy: 'client' | 'barber' | null
    }
  }
  ```

### 7.3 `PATCH /barber/recurring-bookings/:id/accept`

Accept a pending offer. Generates the 60-day window of `confirmed` bookings synchronously.

- **Auth:** required (barber)
- **Body:** none
- **Response 200:** `{ recurringBooking: RecurringBookingDto }` (status now `active`).

### 7.4 `PATCH /barber/recurring-bookings/:id/decline`

Decline a pending offer.

- **Auth:** required (barber)
- **Body:** `{ "reason": "string (optional, max 500)" }`
- **Response 200:** `{ recurringBooking: RecurringBookingDto }` (status `cancelled`, `barberDeclinedAt` set).

### 7.5 `PATCH /barber/recurring-bookings/:id/pause`

- **Auth:** required (barber)
- **Body:**
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `pauseStartDate` | `'YYYY-MM-DD'` | yes | |
  | `pauseEndDate` | `'YYYY-MM-DD'` | no | omit for indefinite pause |
- **Response 200:** `{ recurringBooking }` (status `paused`).

### 7.6 `PATCH /barber/recurring-bookings/:id/resume`

Resumes from `paused`. The system re-fills the 60-day window.

- **Auth:** required (barber)
- **Body:** none
- **Response 200:** `{ recurringBooking }`.

### 7.7 `PATCH /barber/recurring-bookings/:id/cancel`

Cancels the subscription. Future generated bookings are cancelled; past/completed rows are preserved.

- **Auth:** required (barber)
- **Body:** none
- **Response 200:** `{ recurringBooking }` (status `cancelled`, `cancelledBy: 'barber'`).

---

## 8. My Clients

The "My Clients" surface lets a barber browse every person who has ever booked them, then drill into one client to see their entire history + every upcoming appointment (one-off and recurring) + lifetime value.

A user is a *client of barber X* if they have **at least one non-cancelled booking** with X. `no_show` counts (they were on the books); pure-cancelled clients are excluded. Aggregates are computed in the database (`get_barber_clients` / `get_barber_client_detail` Postgres functions) so list queries are constant-round-trip regardless of page size.

> Guest / walk-in clients are not supported by the schema (`bookings.client_id` is a NOT NULL FK to `auth.users`). `isGuest` is therefore always `false`. Phone, date of birth, and barber-side notes columns also do not exist; those fields are intentionally omitted from the response.

### 8.1 `GET /barber/clients`

Page-based list of distinct clients with rolled-up stats.

- **Auth:** required (barber)
- **Query** (`ListBarberClientsQueryDto`):
  | Param | Type | Required | Notes |
  |---|---|---|---|
  | `search` | string (≤100) | no | case-insensitive partial match on the client's `name` or auth `email` |
  | `sortBy` | `'lastVisit' \| 'totalSpend' \| 'totalVisits' \| 'name'` | no | default `lastVisit` |
  | `order` | `'asc' \| 'desc'` | no | default `desc` |
  | `page` | int ≥ 1 | no | default `1` |
  | `limit` | 1..100 | no | default `20` |
  | `hasUpcoming` | boolean | no | when `true`, only clients with at least one future `pending`/`confirmed` booking |
- **Response 200** (`ListBarberClientsResponseDto`):
  ```ts
  {
    clients: [{
      clientId: string;
      name: string;
      profilePhotoUrl: string | null;
      email: string | null;            // pulled from auth.users
      totalVisits: number;             // count of bookings with status='completed'
      totalSpendUsd: number;           // SUM(price_usd) over completed bookings
      firstVisitAt: string | null;     // ISO — earliest completed booking
      lastVisitAt: string | null;      // ISO — latest completed booking
      nextBookingAt: string | null;    // ISO — earliest future pending/confirmed booking
      hasUpcoming: boolean;
      isGuest: boolean;                // always false (see section preamble)
    }];
    pagination: {
      currentPage: number;
      totalPages: number;
      limit: number;
      hasNextPage: boolean;
      totalClients: number;
    };
  }
  ```

### 8.2 `GET /barber/clients/:clientId`

Full detail for one client, scoped to the authenticated barber. Returns **`404`** if the requested `clientId` has no non-cancelled booking with this barber — existence is never leaked via `403`.

- **Auth:** required (barber)
- **Path:** `clientId` is the auth user UUID of the client.
- **Query** (`GetBarberClientDetailQueryDto`):
  | Param | Type | Required | Notes |
  |---|---|---|---|
  | `pastPage` | int ≥ 1 | no | page index for `pastBookings`. Default `1`. |
  | `pastLimit` | 1..50 | no | page size for `pastBookings`. Default `10`. |
- **Response 200** (`BarberClientDetailDto`):
  ```ts
  {
    client: {
      id: string;
      name: string;
      profilePhotoUrl: string | null;
      email: string | null;
      createdAt: string | null;        // auth account creation
      isGuest: boolean;                // always false
    };
    stats: {
      totalVisits: number;
      totalSpendUsd: number;
      averageSpendUsd: number;         // totalSpendUsd / totalVisits, 0 when totalVisits=0
      firstVisitAt: string | null;
      lastVisitAt: string | null;
      noShowCount: number;
      cancellationCount: number;
      favouriteService: { id: string; name: string } | null;  // most-used service in completed bookings, tie-break by most recent
    };
    upcomingBookings: [BarberClientBookingDto];   // status IN (pending, confirmed) AND scheduled_at > now(), ascending
    pastBookings: {
      items: [BarberClientBookingDto];            // scheduled_at < now(), descending — completed/cancelled/no_show all visible
      pagination: {
        currentPage: number;
        totalPages: number;
        limit: number;
        hasNextPage: boolean;
        totalBookings: number;
      };
    };
    recurringSeries: [{
      id: string;
      dayOfWeek: number;               // 0..6
      slotTime: string;                // 'HH:mm'
      frequency: 'weekly' | 'biweekly';
      status: RecurringStatus;
      active: boolean;                 // true for status IN (active, pending_barber_approval, paused)
      priceUsd: number;
      service: { id, name };
      nextOccurrenceAt: string | null; // ISO — next pending/confirmed materialised occurrence
      startedAt: string;               // barberAcceptedAt or createdAt
      cancelledAt: string | null;
    }];
  }
  ```
  `BarberClientBookingDto`:
  ```ts
  {
    id: string;
    status: BookingStatus;
    scheduledAt: string;               // ISO — block start
    totalDurationMinutes: number;      // total block duration including all services
    bookingType: BookingType;          // type of the primary (first) service
    services: [{ id, name, durationMinutes, bookingType, priceUsd }];
    totalPriceUsd: number;
    isRecurring: boolean;
    recurringBookingId: string | null;
    cancelledAt: string | null;
    cancelledBy: 'client' | 'barber' | null;
  }
  ```

> Recurring is materialised (Option A): every accepted recurring contract spawns real `bookings` rows for the next 60 days. The `upcomingBookings` array therefore already contains those occurrences (with `isRecurring: true`); `recurringSeries` lists the parent contracts for context only — no synthetic occurrences are generated.

---

## 9. Reviews

### 8.1 `GET /barber/reviews`

The barber's own reviews, newest first. Supports filtering by star rating to back the "All / 5★ / 4★ / 3★ / 2★ / 1★" tab strip.

- **Auth:** required (barber)
- **Query** (`ListReviewsQueryDto`):
  | Param | Type | Required | Notes |
  |---|---|---|---|
  | `cursor` | uuid | no | |
  | `limit` | 1..50 | no | default 20 |
  | `rating` | int 1..5 | no | when set, only reviews with this exact star count are returned. Omit for "All". |
- **Response 200** (`ReviewsListResponseDto`):
  ```ts
  {
    barber: {
      id: string;
      name: string;
      averageRating: number | null;   // null when 0 reviews — UNFILTERED average across all ratings
      totalReviews: number;           // UNFILTERED total across all ratings (drives the "X total" header)
    };
    reviews: [{
      id: string;
      client: { name: string; profilePhotoUrl: string | null };
      rating: number;                 // 1..5
      comment: string | null;
      relativeTime: string;           // e.g. "6 months ago"
      createdAt: string;
    }];
    nextCursor: string | null;
    hasMore: boolean;
  }
  ```

> The `barber.averageRating` and `barber.totalReviews` fields are computed from **all** reviews — they do not change when `rating` is set. Only the `reviews` array is filtered. Use `GET /barber/reviews/analytics` (8.2) to drive the per-star bars.

### 8.2 `GET /barber/reviews/analytics`

Aggregate breakdown for the reviews screen header (the bar chart with star-by-star counts in the screenshot).

- **Auth:** required (barber)
- **Query:** none
- **Response 200** (`ReviewsAnalyticsResponseDto`):
  ```ts
  {
    totalReviews: number;             // 7 → "7 total"
    averageRating: number | null;     // 4.6 → big number on the left
    ratingsBreakdown: [               // always 5 entries, ordered 5 → 1
      { rating: 5, count: 5, percentage: 71 },
      { rating: 4, count: 1, percentage: 14 },
      { rating: 3, count: 1, percentage: 14 },
      { rating: 2, count: 0, percentage: 0 },
      { rating: 1, count: 0, percentage: 0 }
    ];
  }
  ```
  - `percentage` is a whole number (`Math.round((count / totalReviews) * 100)`). Use it directly as the bar fill width.
  - When `totalReviews === 0`: `averageRating = null` and every breakdown entry has `count = 0, percentage = 0`.

---

## 10. Conversations / Messaging

Chat threads. Both barbers and clients use `/conversations`. **Only barbers can start a new thread.**

### 9.1 `GET /conversations`

- **Auth:** required (barber or client)
- **Query** (`ListConversationsQueryDto`):
  | Param | Type | Required | Notes |
  |---|---|---|---|
  | `page` | int ≥ 1 | no | default 1 |
  | `limit` | 1..100 | no | default 20 |
  | `search` | string | no | partial match on the other party's name |
- **Response 200** (`ListConversationsResponseDto`):
  ```ts
  {
    conversations: [{
      id: string;
      otherParty: { id, name, profilePhotoUrl };
      lastMessageBody: string | null;
      lastMessageAt: string | null;       // ISO
      lastMessageSenderRole: 'barber' | 'client' | null;
      unreadCount: number;
      hasBooking: boolean;                 // does the client have a non-cancelled booking with this barber?
      createdAt: string;
    }];
    pagination: {
      currentPage, totalPages, totalConversations, limit, hasNextPage
    };
  }
  ```

### 9.2 `GET /conversations/:id/messages`

Cursor-paginated message history. **Marks counterparty messages as read.**

- **Auth:** required
- **Query** (`ListMessagesQueryDto`):
  | Param | Type | Required | Notes |
  |---|---|---|---|
  | `before` | uuid | no | cursor — message id; returns rows strictly before this one |
  | `limit` | 1..100 | no | default 30 |
- **Response 200** (`ListMessagesResponseDto`) — messages are returned **ascending by created_at** (oldest first), so prepend older pages to the top of the thread:
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
    nextCursor: string | null;       // pass as `before` for the next page
  }
  ```

### 9.3 `POST /conversations/:id/messages`

- **Auth:** required
- **Body:** `{ "body": "string (1..1000)" }`
- **Response 201:** `{ "message": MessageDto }`

### 9.4 `POST /conversations/start` *(barber-only)*

Start a thread with a client. If a thread already exists, returns the existing one (idempotent).

- **Auth:** required (barber)
- **Body:** `{ "clientId": "<auth user uuid of the client>" }`
- **Response 200:** `{ "conversation": ConversationListItemDto }` (idempotent — returns the existing thread if one already exists)

> **Realtime:** Subscribe to Supabase Realtime on the `messages` table filtered by `conversation_id` to receive live updates between API polls.

---

## 11. Push Notifications

Expo / FCM push tokens are stored per `(user_id, platform)`.

### 10.1 `POST /device-token`

Register or refresh the caller's push token (upsert on `user_id, platform`).

- **Auth:** required
- **Body:**
  | Field | Type | Required | Notes |
  |---|---|---|---|
  | `token` | string | yes | `ExponentPushToken[…]` or FCM token, max 512 chars |
  | `platform` | `'ios' \| 'android'` | yes | |
- **Response 200:** `{ "id": "<row id>", "token": "<token>", "platform": "ios" }`

### 10.2 `DELETE /device-token`

Call on logout. Only removes the caller's own token.

- **Auth:** required
- **Body:** `{ "token": "<token>" }`
- **Response 200:** `{ "removed": true }`

### 10.3 `GET /barber/notifications`

Page-paginated, newest first.

- **Auth:** required (barber)
- **Query:** `page` (default 1), `limit` (default 20, max 100).
- **Response 200** (`ListNotificationsResponseDto`):
  ```ts
  {
    notifications: [{
      id: string;
      type: NotificationType;
      title: string;
      body: string;
      data: Record<string, unknown>;        // freeform payload — used for deep linking
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

### 10.4 `GET /barber/notifications/unread-count`

- **Auth:** required (barber)
- **Response 200:** `{ "unreadCount": 5 }`

### 10.5 `PUT /barber/notifications/:notificationId/read`

- **Auth:** required (barber)
- **Body:** none
- **Response 200:** `{ "id": "<id>", "isRead": true }`

---

## 12. Notification Settings

Two independent toggles for what kinds of push notifications the barber receives.

### 11.1 `GET /barber/notification-settings`

- **Auth:** required (barber)
- **Response 200:**
  ```json
  {
    "normal_bookings": true,
    "recurring_bookings": true
  }
  ```
  - `normal_bookings` → controls `new_booking` and `cancelled_booking` push.
  - `recurring_bookings` → controls `new_recurring_request`, `recurring_cancelled`, `recurring_paused` push.

### 11.2 `PUT /barber/notification-settings`

- **Auth:** required (barber)
- **Body:** `{ "normal_bookings": boolean, "recurring_bookings": boolean }` (both required)
- **Response 200:** the same shape as `GET`.

---

## 13. Analytics

### 12.1 `GET /bookings/analytics`

Earnings analytics for the authenticated barber over a rolling window. Counts only `completed` bookings; no-show charges are **excluded**.

- **Auth:** required (barber)
- **Query** (`AnalyticsQueryDto`):
  | Param | Type | Required | Notes |
  |---|---|---|---|
  | `period` | `'week' \| 'month' \| 'year'` | yes | rolling window ending now |
- **Response 200** (`AnalyticsResponseDto`):
  ```ts
  {
    period: 'week' | 'month' | 'year';
    period_days: number;                  // 7 / 30 / 365
    window_start: string;                 // ISO timestamp (UTC)
    window_end: string;                   // ISO timestamp (UTC)
    total_earnings_usd: number;           // sum across all completed bookings
    standard_bookings: {
      regular:     { count: number; total_usd: number };
      after_hours: { count: number; total_usd: number };
      day_off:     { count: number; total_usd: number };
    };
    recurring: {
      total_occurrences_completed: number;
      total_usd: number;
      per_arrangement: [{
        arrangement_id: string;           // recurring_booking id
        client_name: string;
        service_name: string;
        day_of_week: number;              // 0..6
        time_slot: string;                // 'HH:mm:ss'
        frequency: 'weekly' | 'biweekly';
        occurrences_completed: number;
        total_usd: number;
      }];
    };
  }
  ```

---

## 14. Stripe Connect & No-Show Charges

To bill clients for no-shows, a barber must connect a **Stripe Express** account. The platform creates the account on demand, sends the barber to a Stripe-hosted onboarding URL, and tracks the resulting capabilities. Once `chargesEnabled = true`, the barber can turn on no-show charges (Section 5.4); the no-show flow on `PATCH /barber/bookings/:id/no-show` will charge the client's saved card via the Connect account using a destination charge.

> The mobile app **never collects or stores barber bank/SSN data**. All KYC happens on Stripe's hosted page.

### Onboarding flow (mobile)

1. App calls `POST /barbers/me/connect/onboard` → receives `onboardingUrl`.
2. App opens that URL in an in-app browser (`expo-web-browser` `openAuthSessionAsync` is recommended) or system browser.
3. Barber completes Stripe's KYC. Stripe redirects to:
   - `APP_URL_BARBER/connect/return` — onboarding submitted (does **not** mean charges_enabled is true; verification can be pending).
   - `APP_URL_BARBER/connect/refresh` — link expired or barber bailed out. Re-call `/onboard` to mint a fresh link.
4. After redirect, the app calls `GET /barbers/me/connect/status` to read live capabilities.
5. When `chargesEnabled === true`, the no-show toggle (`PATCH /barber/settings/no-show-charge`) becomes usable.

`requirementsCurrentlyDue` lists fields Stripe is still asking for (e.g. `individual.dob.day`). Show them in the UI; if non-empty, route the barber back through `/onboard` to complete them.

### 13.1 `POST /barbers/me/connect/onboard`

Begin or resume Express onboarding. Creates the Connect account on first call (idempotent — subsequent calls return a fresh link for the same account).

- **Auth:** required (barber)
- **Body:** none
- **Response 201** (`ConnectOnboardResponseDto`):
  ```json
  { "onboardingUrl": "https://connect.stripe.com/setup/e/acct_1Oj..." }
  ```
  The URL is one-time and expires after first use.

### 13.2 `GET /barbers/me/connect/status`

Live capabilities snapshot from Stripe (no caching — call after each redirect).

- **Auth:** required (barber)
- **Response 200** (`ConnectStatusResponseDto`):
  ```ts
  {
    connected: boolean;                   // false ⇒ no Connect account on file
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    requirementsCurrentlyDue: string[];   // empty when fully verified
  }
  ```

### 13.3 `DELETE /barbers/me/connect`

Disconnect (delete) the Express account. Idempotent. **Forces `no_show_charge_enabled = false`** so the barber cannot leave the toggle on without a backing account.

- **Auth:** required (barber)
- **Body:** none
- **Response 200:** `{ "disconnected": true }`

### What happens on a no-show

When the barber calls `PATCH /barber/bookings/:id/no-show` (Section 6.6):

- The booking is marked `no_show`.
- If the no-show charge feature is enabled and the client has a saved card on their subscription, the system creates a Stripe `PaymentIntent` against the client's card with the destination set to the barber's Connect account.
- The booking response surfaces the outcome via `noShowCharged` and `noShowChargeAmountUsd`. Skipped reasons (no card / no Connect / disabled / Connect not in `charges_enabled`) are logged but do not fail the no-show transition itself.
- Booking detail (`GET /barber/bookings/:id`) reflects the updated charge fields after the webhook (`payment_intent.succeeded`) settles.

---

## Common Error Codes

| Status | Meaning | Typical cause |
|---|---|---|
| 400 | Validation error | missing or malformed field; class-validator rejected the body/query |
| 401 | Unauthorized | missing / expired access token; refresh and retry |
| 403 | Forbidden | wrong role (e.g. client hitting `/barber/...`) |
| 404 | Not found | id does not exist or belongs to another user |
| 409 | Conflict | double booking, duplicate username, illegal state transition (e.g. confirming an already-cancelled booking), `CONNECT_REQUIRED` when enabling no-show charge without a verified Connect account |
| 500 | Server error | log and retry; report if persistent |

Common application error codes (`code` field in the error envelope):
- `SUBSCRIPTION_REQUIRED` — only used on the client side; included for completeness.
- `CONNECT_REQUIRED` — `PATCH /barber/settings/no-show-charge` rejected because the Connect account is missing or not in `charges_enabled` state.

The mobile app should treat `401` as a signal to call `POST /auth/refresh` once and retry, then fall back to logout if refresh also returns 401.

---

## Quick Endpoint Index (Barber)

| Group | Method | Path |
|---|---|---|
| Auth | POST | `/auth/barber/step1` |
| Auth | POST | `/auth/barber/step2` |
| Auth | POST | `/auth/barber/step3` |
| Auth | POST | `/auth/login` |
| Auth | POST | `/auth/refresh` |
| Auth | POST | `/auth/logout` |
| Auth | GET | `/auth/me` |
| Auth | POST | `/auth/forgot-password` |
| Auth | POST | `/auth/reset-password` |
| Auth | PATCH | `/auth/change-password` |
| Profile | GET | `/barber/profile` |
| Profile | PATCH | `/barber/profile` |
| Home | GET | `/barber/home` |
| Services | POST | `/barbers/:barberId/services` |
| Services | GET | `/barbers/:barberId/services` |
| Services | GET | `/barbers/:barberId/services/:serviceId` |
| Services | PATCH | `/barbers/:barberId/services/:serviceId` |
| Services | PATCH | `/barbers/:barberId/services/:serviceId/toggle` |
| Services | PATCH | `/barbers/:barberId/services/reorder` |
| Schedule | GET | `/schedule` |
| Schedule | PATCH | `/schedule/:dayOfWeek` |
| Settings | PATCH | `/barber/settings/auto-confirm` |
| Settings | PATCH | `/barber/settings/auto-confirm-today` |
| Settings | PATCH | `/barber/settings/recurring` |
| Settings | PATCH | `/barber/settings/no-show-charge` |
| Bookings | GET | `/barber/bookings` |
| Bookings | GET | `/barber/bookings/:id` |
| Bookings | PATCH | `/barber/bookings/:id/confirm` |
| Bookings | PATCH | `/barber/bookings/:id/cancel` |
| Bookings | PATCH | `/barber/bookings/:id/complete` |
| Bookings | PATCH | `/barber/bookings/:id/no-show` |
| Recurring | GET | `/barber/recurring-bookings` |
| Recurring | GET | `/barber/recurring-bookings/:id` |
| Recurring | PATCH | `/barber/recurring-bookings/:id/accept` |
| Recurring | PATCH | `/barber/recurring-bookings/:id/decline` |
| Recurring | PATCH | `/barber/recurring-bookings/:id/pause` |
| Recurring | PATCH | `/barber/recurring-bookings/:id/resume` |
| Recurring | PATCH | `/barber/recurring-bookings/:id/cancel` |
| Reviews | GET | `/barber/reviews` |
| Reviews | GET | `/barber/reviews/analytics` |
| Messages | GET | `/conversations` |
| Messages | GET | `/conversations/:id/messages` |
| Messages | POST | `/conversations/:id/messages` |
| Messages | POST | `/conversations/start` |
| Push | POST | `/device-token` |
| Push | DELETE | `/device-token` |
| Notifications | GET | `/barber/notifications` |
| Notifications | GET | `/barber/notifications/unread-count` |
| Notifications | PUT | `/barber/notifications/:notificationId/read` |
| Notification settings | GET | `/barber/notification-settings` |
| Notification settings | PUT | `/barber/notification-settings` |
| Analytics | GET | `/bookings/analytics` |
| Connect | POST | `/barbers/me/connect/onboard` |
| Connect | GET | `/barbers/me/connect/status` |
| Connect | DELETE | `/barbers/me/connect` |
