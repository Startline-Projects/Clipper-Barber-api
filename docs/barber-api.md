# Barber API Reference

Target audience: the mobile **barber app** (developers integrating the React Native / Expo barber-side client).

This document covers every endpoint a barber user hits — from onboarding through day-to-day operations: managing services, schedule, bookings, recurring subscriptions, reviews, conversations, and notifications.

---

## Table of Contents

1. [Conventions](#conventions)
2. [Shared Enums](#shared-enums)
3. [Auth & Onboarding](#1-auth--onboarding)
4. [Profile](#2-profile)
5. [Services](#3-services)
6. [Schedule](#4-schedule)
7. [Settings](#5-settings)
8. [Bookings (one-off)](#6-bookings-one-off)
9. [Recurring Bookings](#7-recurring-bookings)
10. [Reviews](#8-reviews)
11. [Conversations / Messaging](#9-conversations--messaging)
12. [Push Notifications](#10-push-notifications)
13. [Notification Settings](#11-notification-settings)
14. [Common Error Codes](#common-error-codes)

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

---

## 2. Profile

`BarberProfileResponseDto` is returned from `/auth/barber/step3` and `/auth/me`.

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

## 8. Reviews

### 8.1 `GET /barber/reviews`

The barber's own reviews, newest first.

- **Auth:** required (barber)
- **Query** (`ListReviewsQueryDto`):
  | Param | Type | Required | Notes |
  |---|---|---|---|
  | `cursor` | uuid | no | |
  | `limit` | 1..50 | no | default 20 |
- **Response 200** (`ReviewsListResponseDto`):
  ```ts
  {
    barber: {
      id: string;
      name: string;
      averageRating: number | null;   // null when 0 reviews
      totalReviews: number;
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

---

## 9. Conversations / Messaging

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
- **Response 201:** `{ "conversation": ConversationListItemDto }`

> **Realtime:** Subscribe to Supabase Realtime on the `messages` table filtered by `conversation_id` to receive live updates between API polls.

---

## 10. Push Notifications

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

## 11. Notification Settings

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

## Common Error Codes

| Status | Meaning | Typical cause |
|---|---|---|
| 400 | Validation error | missing or malformed field; class-validator rejected the body/query |
| 401 | Unauthorized | missing / expired access token; refresh and retry |
| 403 | Forbidden | wrong role (e.g. client hitting `/barber/...`) |
| 404 | Not found | id does not exist or belongs to another user |
| 409 | Conflict | double booking, duplicate username, illegal state transition (e.g. confirming an already-cancelled booking) |
| 500 | Server error | log and retry; report if persistent |

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
