# Barber API Reference

Target audience: the mobile barber app. Integration reference for every endpoint a barber user hits, from onboarding through day-to-day operations.

## Conventions

- **Base URL:** `http://localhost:3001` (dev). Production URL set per environment.
- **Auth:** `Authorization: Bearer <accessToken>` on every call marked `auth: JWT`.
- **Role gating:** `role: barber` endpoints reject other roles with `403`. Role is carried in the JWT's `user_metadata.role`.
- **Content type:** `application/json` unless noted otherwise (Step 3 onboarding uses `multipart/form-data`).
- **Dates:** Times use `HH:mm` 24-hour. Calendar dates use `YYYY-MM-DD`. Timestamps in responses are ISO 8601 UTC.
- **Error shape:** Global filter produces `{ error: true, message: string, code?: string }`. Validation errors return `400`; auth failures `401`; role failures `403`; not found `404`; unique conflict `409`.
- **Pagination:** Cursor-based. Pass `cursor=<id-of-last-item>` and `limit` (default 20, max 50). Response carries `nextCursor` + `hasMore`.

---

## Shared Enums

```ts
ServiceType         = 'haircut' | 'beard' | 'haircut_beard' | 'eyebrows' | 'other'
BookingType         = 'regular' | 'after_hours' | 'day_off'
BookingStatus       = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
BookingTimeframe    = 'upcoming' | 'past'
BookingTypeFilter   = 'one_off' | 'recurring'
DurationMinutes     = 15 | 30 | 45 | 60
SlotDurationMinutes = 15 | 30 | 45 | 60
RecurringFrequency  = 'weekly' | 'biweekly'                // on a subscription
RecurringFreqOption = 'weekly' | 'biweekly' | 'both'       // on a schedule day
RecurringStatus     = 'pending_barber_approval' | 'active' | 'paused' | 'cancelled' | 'expired'
CancelledBy         = 'client' | 'barber'
DayOfWeek           = 0..6                                 // 0 = Sunday, 6 = Saturday
```

---

# 1. Onboarding (Auth)

## 1.1. `POST /auth/barber/step1` — create account

- **Context:** Creates Supabase auth user (role = barber) + an empty `barbers` profile row. Returns tokens so the app can authenticate step 2 and step 3.
- **Auth:** none.
- **Request:**
  ```json
  {
    "fullName": "John Doe",
    "email": "barber@example.com",
    "password": "SecurePass1!"
  }
  ```
- **Validation:** `fullName` ≤ 100 chars, valid email, password ≥ 8 chars.
- **Response 201:** `{ "accessToken": "…", "refreshToken": "…" }`

## 1.2. `POST /auth/barber/step2` — shop details

- **Context:** Writes shop address + coordinates onto the barber row.
- **Auth:** JWT (from step 1). Role: barber.
- **Request:**
  ```json
  {
    "shopName": "The Fade Factory",
    "phone": "+1 (555) 123-4567",
    "streetAddress": "123 Main St",
    "city": "Austin",
    "state": "TX",
    "zipCode": "78701",
    "latitude": 30.2672,
    "longitude": -97.7431
  }
  ```
- **Validation:** phone must match `^[+\d\s\-()]+$`; zip `^\d{5}(-\d{4})?$`; lat `-90..90`; lng `-180..180`.
- **Response 201:** `{ "success": true }`

## 1.3. `POST /auth/barber/step3` — profile photo + bio

- **Context:** Finalises onboarding. Uploads an optional photo to Supabase Storage and marks `onboarding_complete = true`.
- **Auth:** JWT. Role: barber.
- **Content-Type:** `multipart/form-data`.
- **Fields:**

  | Field | Type | Notes |
  |---|---|---|
  | `photo` | binary, optional | Max 5 MB |
  | `bio` | string, optional | Max 500 chars |
  | `instagramHandle` | string, optional | No `@`; matches `[a-zA-Z0-9._]+`, max 50 |

- **Response 201:** `BarberProfile` (snake_case fields — see `BarberProfileResponseDto`):
  ```json
  {
    "id": "uuid",
    "full_name": "John Doe",
    "shop_name": "The Fade Factory",
    "phone": "+15551234567",
    "street_address": "…",
    "city": "…",
    "state": "TX",
    "zip_code": "78701",
    "latitude": 30.2672,
    "longitude": -97.7431,
    "bio": "…",
    "instagram_handle": "john.cuts",
    "profile_photo_url": "https://…",
    "onboarding_step": 3,
    "onboarding_complete": true,
    "created_at": "2026-04-20T12:00:00.000Z"
  }
  ```

## 1.4. `POST /auth/login` — log in

- **Context:** Shared with clients; app passes `role`.
- **Auth:** none.
- **Request:**
  ```json
  { "email": "barber@example.com", "password": "SecurePass1!", "role": "barber" }
  ```
- **Response 201:**
  ```json
  {
    "accessToken": "…",
    "refreshToken": "…",
    "id": "uuid",
    "email": "barber@example.com",
    "username": "John Doe",
    "redirectTo": "barber/step2"
  }
  ```
  `redirectTo` is only present when onboarding is incomplete. Values: `"barber/step2"`, `"barber/step3"`.

## 1.5. `POST /auth/refresh` — refresh access token

- **Auth:** none.
- **Request:** `{ "refreshToken": "…" }`
- **Response 201:** `{ "accessToken": "…", "refreshToken": "…" }`

## 1.6. `POST /auth/logout`

- **Auth:** JWT.
- **Response 201:** `{ "success": true }`

## 1.7. `GET /auth/me`

- **Context:** Returns the barber (or client) profile for the JWT holder.
- **Auth:** JWT.
- **Response 201 for barber:** `BarberProfile` (same shape as 1.3).

## 1.8. `POST /auth/forgot-password`

- **Request:** `{ "email": "barber@example.com" }`
- **Response 201:** `{ "success": true }` (always — no email enumeration).

## 1.9. `POST /auth/reset-password`

- **Request:** `{ "token": "<token_hash from email link>", "newPassword": "NewSecurePass1!" }`
- **Response 201:** `{ "success": true }`

---

# 2. Schedule

Every barber is seeded with 7 rows (Sun=0 .. Sat=6) on signup. All fields are partially updatable via PATCH.

## 2.1. `GET /schedule` — list all 7 days

- **Auth:** JWT. Role: barber.
- **Response 200:** `{ "success": true, "data": ScheduleDay[] }`

`ScheduleDay`:
```ts
{
  id: string;
  barberId: string;
  dayOfWeek: 0..6;                 // 0 = Sunday, 6 = Saturday
  isWorking: boolean;
  regularStartTime: "HH:mm" | null;
  regularEndTime:   "HH:mm" | null;
  slotDurationMinutes: 15 | 30 | 45 | 60;
  afterHoursEnabled: boolean;
  afterHoursStart: "HH:mm" | null;
  afterHoursEnd:   "HH:mm" | null;
  dayOffBookingEnabled: boolean;
  dayOffStartTime: "HH:mm" | null;
  dayOffEndTime:   "HH:mm" | null;
  advanceNoticeMinutes: number;            // min minutes before slot that a booking can be placed
  recurringEnabled: boolean;
  recurringFrequency: 'weekly'|'biweekly'|'both' | null;
  recurringExtraChargeUsd: number | null;  // flat surcharge added to service.recurringPriceUsd for this day
  createdAt: string;
  updatedAt: string;
}
```

## 2.2. `PATCH /schedule/:dayOfWeek` — partial update

- **Path param:** `dayOfWeek` = `0..6`.
- **Auth:** JWT. Role: barber.
- **Request — any subset of the fields below:**

  | Field | Type | Notes |
  |---|---|---|
  | `isWorking` | boolean | |
  | `regularStartTime`, `regularEndTime` | `HH:mm` | required when `isWorking=true` |
  | `slotDurationMinutes` | 15/30/45/60 | |
  | `afterHoursEnabled` | boolean | |
  | `afterHoursStart`, `afterHoursEnd` | `HH:mm` | required when `afterHoursEnabled=true`; start ≥ regularEnd |
  | `dayOffBookingEnabled` | boolean | cannot coexist with `isWorking=true` |
  | `dayOffStartTime`, `dayOffEndTime` | `HH:mm` | required when `dayOffBookingEnabled=true` |
  | `advanceNoticeMinutes` | int ≥ 0 | |
  | `recurringEnabled` | boolean | setting to `false` clears `recurringFrequency` + `recurringExtraChargeUsd` |
  | `recurringFrequency` | `weekly\|biweekly\|both` | required when `recurringEnabled=true` |
  | `recurringExtraChargeUsd` | number ≥ 0 | optional surcharge; null ⇒ no extra charge |

- **Side effect:** `barbers.recurring_enabled` is auto-synced — true iff any day has `recurringEnabled=true`.
- **Response 200:** `{ "success": true, "data": ScheduleDay }`

---

# 3. Services (CRUD)

All endpoints live under `/barbers/:barberId/services/*`. `barberId` is always the authenticated barber's `auth.users.id` — the service enforces ownership.

## 3.1. `POST /barbers/:barberId/services` — create

- **Auth:** JWT. Role: barber.
- **Request:**
  ```json
  {
    "name": "Skin Fade",
    "serviceType": "haircut",
    "durationMinutes": 30,
    "regularPriceUsd": 35.00,
    "afterHoursPriceUsd": 45.00,
    "dayOffPriceUsd": 55.00,
    "recurringPriceUsd": 40.00
  }
  ```

  | Field | Required | Notes |
  |---|---|---|
  | `name` | yes | unique per barber among active services |
  | `serviceType` | yes | `ServiceType` enum |
  | `durationMinutes` | yes | 15 / 30 / 45 / 60 |
  | `regularPriceUsd` | yes | ≥ 0 |
  | `afterHoursPriceUsd` | no | required to sell after-hours slots |
  | `dayOffPriceUsd` | no | required to sell day-off slots |
  | `recurringPriceUsd` | no | null ⇒ service does not support recurring bookings |

- **Response 201:** `{ "success": true, "data": BarberService }` — see 3.3 for shape.
- **Errors:** `409` on duplicate name.

## 3.2. `GET /barbers/:barberId/services` — list (incl. inactive)

- **Response 200:** `{ "success": true, "data": BarberService[] }`

## 3.3. `GET /barbers/:barberId/services/:serviceId`

- **Response 200:** `{ "success": true, "data": BarberService }`

`BarberService`:
```ts
{
  id: string;
  barberId: string;
  name: string;
  serviceType: ServiceType;
  durationMinutes: 15 | 30 | 45 | 60;
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

## 3.4. `PATCH /barbers/:barberId/services/:serviceId` — partial update

- **Request:** any subset of the create DTO. Pass `null` on `afterHoursPriceUsd`, `dayOffPriceUsd`, `recurringPriceUsd` to clear them. `sortOrder` is also accepted.
- **Response 200:** `{ "success": true, "data": BarberService }`

## 3.5. `PATCH /barbers/:barberId/services/:serviceId/toggle`

- **Context:** Flips `isActive`. No body.
- **Response 200:** `{ "success": true, "data": BarberService }`

## 3.6. `PATCH /barbers/:barberId/services/reorder`

- **Context:** Bulk-set `sortOrder` = index for each supplied id.
- **Request:** `{ "serviceIds": ["uuid1", "uuid2", "uuid3"] }`
- **Response 200:** `{ "success": true, "data": BarberService[] }`

---

# 4. Availability (Client View of the Barber)

The barber usually doesn't call this themselves — exposed for the client-side flow.

## 4.1. `GET /barbers/:barberId/availability`

- **Auth:** JWT. Role: **client**.
- **Query:**

  | Param | Type | Required | Notes |
  |---|---|---|---|
  | `serviceId` | UUID | yes | |
  | `startDate` | `YYYY-MM-DD` | yes | clamped to today if in the past |
  | `endDate` | `YYYY-MM-DD` | yes | ≥ `startDate`, ≤ `startDate + 14 days` |

- **Response 200:**
  ```ts
  {
    barberId: string;
    service: { id, name, durationMinutes, regularPrice, afterHoursPrice, dayOffPrice };
    days: Array<{
      date: string;              // YYYY-MM-DD
      dayOfWeek: 0..6;
      isWorkingDay: boolean;
      slotDurationMinutes: number | null;
      slots: {
        regular:    Slot[];
        afterHours: Slot[];
        dayOff:     Slot[];
      };
    }>;
  }
  // Slot: { time, endTime, available, price }
  ```

---

# 5. Barber Bookings

All under `/barber/bookings`. Role: barber.

## 5.1. `GET /barber/bookings` — list with filters

- **Query:**

  | Param | Type | Notes |
  |---|---|---|
  | `timeframe` | `upcoming\|past` | **required** |
  | `bookingType` | `BookingType` | optional |
  | `status` | `BookingStatus` | optional |
  | `type` | `one_off\|recurring` | optional |
  | `cursor` | UUID | optional |
  | `limit` | 1..50 | default 20 |

- **Response 200:**
  ```ts
  {
    bookings: Array<{
      id: string;
      client: { id, name, profilePhotoUrl };
      service: { name, durationMinutes };
      scheduledAt: string;       // ISO UTC
      bookingType: BookingType;
      totalPrice: number;
      status: BookingStatus;
      isRecurring: boolean;
      recurringBookingId: string | null;
      createdAt: string;
    }>;
    nextCursor: string | null;
    hasMore: boolean;
  }
  ```

## 5.2. `GET /barber/bookings/:id` — detail

- **Response 200:**
  ```ts
  {
    booking: {
      id: string;
      client: { id, name, profilePhotoUrl };
      service: { name, durationMinutes };
      scheduledAt: string;
      bookingType: BookingType;
      status: BookingStatus;
      pricing: { basePrice, additionalCost, totalPrice };
      confirmedAt: string | null;
      cancelledAt: string | null;
      cancelledBy: 'client'|'barber'|null;
      noShowCharged: boolean;
      noShowChargeAmountUsd: number | null;
      reviewLeftByClient: boolean;
      isRecurring: boolean;
      recurringBookingId: string | null;
      createdAt: string;
    }
  }
  ```

## 5.3. `PATCH /barber/bookings/:id/confirm`

- **Context:** Only allowed when `status = pending`. No body.
- **Response 200:** `{ "booking": { id, status: "confirmed", confirmedAt } }`

## 5.4. `PATCH /barber/bookings/:id/cancel`

- **Context:** Allowed on `pending` or `confirmed`. No body.
- **Response 200:** `{ "booking": { id, status: "cancelled", cancelledAt, cancelledBy: "barber" } }`

## 5.5. `PATCH /barber/bookings/:id/complete`

- **Context:** Allowed only on `confirmed`. Confirm first if needed. No body.
- **Response 200:** `{ "booking": { id, status: "completed" } }`

## 5.6. `PATCH /barber/bookings/:id/no-show`

- **Context:** Allowed on `confirmed` or `completed` **after** the appointment window has ended (`scheduledAt + duration_minutes < now()`). No body.
- **Response 200:** `{ "booking": { id, status: "no_show" } }`

---

# 6. Barber Settings

## 6.1. `PATCH /barber/settings/auto-confirm`

- **Context:** Turns on auto-confirm for **all** incoming bookings.
- **Request:** `{ "enabled": true }`
- **Response 200:** `{ "allowAutoConfirm": true, "autoConfirmToday": false }`

## 6.2. `PATCH /barber/settings/auto-confirm-today`

- **Context:** Only same-day bookings auto-confirm (evaluated in the barber's timezone). Ignored when `allowAutoConfirm = true`.
- **Request:** `{ "enabled": true }`
- **Response 200:** same shape as 6.1.

## 6.3. `PATCH /barber/settings/recurring`

- **Context:** Barber-level manual override. Auto-synced whenever any schedule day toggles recurring; this endpoint lets the barber force it off without editing every day.
- **Request:** `{ "enabled": true }`
- **Response 200:** `{ "recurringEnabled": true }`

---

# 7. Barber Recurring Bookings

All endpoints `role: barber`. See [docs/recurring-bookings.md] or the Postman collection for a full flow walkthrough.

## 7.1. `GET /barber/recurring-bookings` — list

- **Query:**

  | Param | Type | Notes |
  |---|---|---|
  | `status` | `RecurringStatus` | optional — use `pending_barber_approval` to find incoming offers |
  | `cursor` | UUID | optional |
  | `limit` | 1..50 | default 20 |

- **Response 200:**
  ```ts
  {
    recurringBookings: Array<{
      id: string;
      status: RecurringStatus;
      isRenewal: boolean;
      dayOfWeek: 0..6;
      slotTime: "HH:mm";
      frequency: 'weekly'|'biweekly';
      priceUsd: number;
      service: { id, name, durationMinutes };
      barber: { id, name };
      client: { id, name };
      nextOccurrenceAt: string | null;   // ISO UTC; next upcoming confirmed/pending booking
      createdAt: string;
    }>;
    nextCursor: string | null;
    hasMore: boolean;
  }
  ```

## 7.2. `GET /barber/recurring-bookings/:id` — detail

- **Response 200:** `{ recurringBooking: RecurringBookingDetail }`

```ts
RecurringBookingDetail = RecurringBooking & {
  pastOccurrences:     { bookingId, scheduledAt, status }[];  // all history
  upcomingOccurrences: { bookingId, scheduledAt, status }[];  // capped at 8
}

RecurringBooking = {
  id: string;
  status: RecurringStatus;
  isRenewal: boolean;
  originalRecurringBookingId: string | null;
  dayOfWeek: 0..6;
  slotTime: "HH:mm";
  frequency: 'weekly'|'biweekly';
  priceUsd: number;
  pauseStartDate: string | null;    // YYYY-MM-DD
  pauseEndDate:   string | null;    // YYYY-MM-DD (null ⇒ indefinite)
  windowStartDate: string | null;   // YYYY-MM-DD, set on accept
  service: { id, name, durationMinutes };
  barber:  { id, name };
  client:  { id, name };
  createdAt: string;
  barberAcceptedAt: string | null;
  barberDeclinedAt: string | null;
  declinedReason:   string | null;
  cancelledAt:      string | null;
  cancelledBy:      'client'|'barber'|null;
}
```

## 7.3. `PATCH /barber/recurring-bookings/:id/accept`

- **Context:** Moves `pending_barber_approval → active`, stamps `barberAcceptedAt`, sets `windowStartDate = today`, and **synchronously generates 60 days of `confirmed` booking rows**. This call can take longer than others — expect a few seconds.
- **Request:** no body.
- **Response 200:** `{ recurringBooking: RecurringBooking }`.
- **Errors:** `400` if status is not pending.

## 7.4. `PATCH /barber/recurring-bookings/:id/decline`

- **Request:** `{ "reason": "I'm fully booked on Tuesdays" }` *(reason optional, max 500)*
- **Response 200:** `{ recurringBooking: RecurringBooking }` (status = `cancelled`, `cancelledBy = "barber"`).

## 7.5. `PATCH /barber/recurring-bookings/:id/pause`

- **Request:**
  ```json
  { "pauseStartDate": "2026-05-01", "pauseEndDate": "2026-05-31" }
  ```
  `pauseEndDate` is optional — omit for indefinite pause. `pauseStartDate` must not be in the past (barber timezone).
- **Side effect:** Cancels any already-generated booking rows inside the pause range; past rows are untouched.
- **Response 200:** `{ recurringBooking: RecurringBooking }` (status = `paused`).

## 7.6. `PATCH /barber/recurring-bookings/:id/resume`

- **Context:** Clears the pause window and re-fills any gaps in the remaining 60-day window.
- **Request:** no body.
- **Response 200:** `{ recurringBooking: RecurringBooking }` (status = `active`).

## 7.7. `PATCH /barber/recurring-bookings/:id/cancel`

- **Context:** Cancels the subscription and all future `pending`/`confirmed` bookings linked to it. Past/completed rows are preserved. Not reversible.
- **Request:** no body.
- **Response 200:** `{ recurringBooking: RecurringBooking }` (status = `cancelled`, `cancelledBy = "barber"`).

---

# 8. Reviews

## 8.1. `GET /barber/reviews` — my reviews

- **Auth:** JWT. Role: barber.
- **Query:** `cursor` (UUID, optional), `limit` (1..50, default 20).
- **Response 200:**
  ```ts
  {
    barber: { id, name, averageRating, totalReviews };
    reviews: Array<{
      id: string;
      client: { name, profilePhotoUrl };
      rating: 1..5;
      comment: string | null;
      relativeTime: string;   // e.g. "2 days ago"
      createdAt: string;
    }>;
    nextCursor: string | null;
    hasMore: boolean;
  }
  ```

---

# 9. Putting It Together — Barber Onboarding Flow

The minimum sequence to get a new barber from "just signed up" to "accepting bookings":

1. `POST /auth/barber/step1` → capture tokens.
2. `POST /auth/barber/step2` → shop details.
3. `POST /auth/barber/step3` → photo + bio (multipart).
4. `POST /barbers/:barberId/services` → one or more services. Include `recurringPriceUsd` if the barber will offer recurring bookings for that service.
5. `PATCH /schedule/:dayOfWeek` for each working day. Set `isWorking`, `regularStartTime`/`regularEndTime`, `slotDurationMinutes`, and any of `afterHoursEnabled`, `dayOffBookingEnabled`, `recurringEnabled` + `recurringFrequency` the barber wants.
6. *(optional)* `PATCH /barber/settings/auto-confirm` or `auto-confirm-today` to control how new bookings flow in.
7. The barber is now live. Daily ops live in §5 (manage bookings), §7 (recurring subscriptions), §8 (reviews).

---

# 10. HTTP Status Codes Quick Reference

| Code | When |
|---|---|
| 200 | Successful `GET` / `PATCH` / `PUT` |
| 201 | Successful `POST` (also `/auth/*` endpoints per NestJS defaults) |
| 400 | Validation failure, bad state transition, business rule violation |
| 401 | Missing / invalid JWT |
| 403 | Role mismatch (role guard) or ownership mismatch |
| 404 | Resource not found or not owned by caller |
| 409 | Unique conflict (slot already taken, renewal already in progress, duplicate service name) |
| 500 | Unhandled server error (bug or DB outage) |
