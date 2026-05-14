# Barber Categories / Tags Feature

Optional **Step 4** of barber onboarding: barbers select multiple
category/specialty tags describing their services. Tags are editable later
from the barber profile and are used to filter barbers in client-facing
listing APIs.

- The step is **optional** and fully skippable.
- Existing barbers are unaffected — the `categories` column defaults to an
  empty array.
- The legacy `barbers.in_house_services` boolean is now part of this system:
  it is mirrored to/from the `IN_HOUSE_SERVICES` tag.

---

## Enum — `BarberCategoryTag`

Defined in [`src/common/enums/barber-category-tag.enum.ts`](../src/common/enums/barber-category-tag.enum.ts).

| Value | |
|---|---|
| `ALL_GENDER_CUTS` | `WOMENS_HAIRCUTS` |
| `KIDS_CUTS` | `LOCS_DREADLOCKS` |
| `CURLY_HAIR_SPECIALIST` | `HAIR_DESIGN` |
| `AFRO_HAIR_SPECIALIST` | `SHAVES` |
| `BRAIDS` | `MOBILE_BARBER` |
| `BEARD_SPECIALIST` | `IN_HOUSE_SERVICES` |
| `SKIN_FADES` | |

`IN_HOUSE_SERVICES` corresponds to the legacy `in_house_services` boolean.

---

## Database Migration

[`supabase/migrations/20260514000001_barber_categories.sql`](../supabase/migrations/20260514000001_barber_categories.sql)

- Adds `barbers.categories text[] NOT NULL DEFAULT '{}'`.
- **Backfill:** every barber with `in_house_services = true` gets the
  `IN_HOUSE_SERVICES` tag appended.
- Adds a GIN index `barbers_categories_gin` to back the `&&` (overlap)
  filter used by the listing APIs.

No breaking change — existing rows get an empty array (or the backfilled
in-house tag).

---

## New APIs

### Signup Step 4 — `POST /auth/barber/step4`

Saves the barber's selected tags. Optional & skippable; does not change
onboarding state (step 3 already completes onboarding). Same tags can be
edited later via `PATCH /barber/profile` or `PATCH /barber/profile/categories`.

- **Auth:** Bearer token, role `barber`.
- **Request DTO:** `BarberSignupCategoriesDto`

```jsonc
{
  "categories": ["SKIN_FADES", "BEARD_SPECIALIST"] // optional; omit/[] to skip
}
```

**Validation:** `categories` optional · must be an array · no duplicates ·
every entry a valid `BarberCategoryTag`.

- **Response:** `201` — full `BarberProfileResponseDto` (see below).

```jsonc
{
  "id": "barber-uuid",
  "full_name": "John Doe",
  "shop_name": "The Fade Factory",
  "categories": ["SKIN_FADES", "BEARD_SPECIALIST"],
  "in_house_services": false,
  "onboarding_complete": true
  // …remaining profile fields
}
```

### Edit Categories — `PATCH /barber/profile/categories`

Dedicated edit endpoint. The supplied array **fully replaces** the current
selection (add / remove / edit the whole set). `[]` clears all tags.

- **Auth:** Bearer token, role `barber`.
- **Request DTO:** `UpdateBarberCategoriesDto`

```jsonc
{ "categories": ["SKIN_FADES", "CURLY_HAIR_SPECIALIST"] }
```

**Validation:** identical to step 4.

- **Response:** `200` — full `BarberProfileResponseDto`.

> Setting / clearing `IN_HOUSE_SERVICES` here also updates the legacy
> `in_house_services` boolean to stay consistent.

---

## Updated APIs

### `POST /auth/barber/step3` · `GET /auth/me` · `GET /barber/profile`

`BarberProfileResponseDto` gains a `categories` field.

- **Old response:** profile object without `categories`.
- **New response:** adds `"categories": BarberCategoryTag[]` (empty array
  when none selected).

### `PATCH /barber/profile`

Accepts an optional `categories` field (array, unique, valid enum values).
When provided it fully replaces the selection and mirrors
`IN_HOUSE_SERVICES` into the `in_house_services` boolean.

- **New request field:** `categories?: BarberCategoryTag[]`
- **New response field:** `categories` on `BarberProfileResponseDto`.

### `PATCH /barber/settings/in-house-services`

Unchanged request/response, but toggling now also adds/removes the
`IN_HOUSE_SERVICES` tag in `barbers.categories` so the two representations
never drift.

### `GET /barber/home`

`BarberHomeResponseDto` gains a `categories` field (the authenticated
barber's tags).

### `GET /client/barbers` — listing + **new filter**

New optional query param:

```
GET /client/barbers?latitude=..&longitude=..&categories=SKIN_FADES,BRAIDS
```

- `categories` accepts a comma-separated list **or** repeated params.
- **Behavior:** returns barbers matching **ANY** of the selected categories
  (array overlap, backed by the GIN index).
- Combines with the existing `sort`, `recurring`, `search`, and pagination
  filters — pagination is applied after filtering, so page counts remain
  correct.

**Response change:** each `BarberListItemDto` gains `categories: BarberCategoryTag[]`.

- **Old item:** `{ id, name, profileImage, averageRating, totalReviews, distance, recurringAvailable, topServices }`
- **New item:** same + `categories`.

Example:

```jsonc
{
  "barbers": [
    {
      "id": "barber-uuid",
      "name": "John",
      "profileImage": null,
      "averageRating": 4.8,
      "totalReviews": 127,
      "distance": { "km": 2.34, "miles": 1.45 },
      "recurringAvailable": true,
      "categories": ["SKIN_FADES", "BRAIDS"],
      "topServices": [{ "name": "Skin Fade" }]
    }
  ],
  "pagination": { "currentPage": 1, "totalPages": 1, "totalBarbers": 1, "limit": 10, "hasNextPage": false }
}
```

### `GET /client/barbers/:barberId` — barber detail

`BarberInfoDto` (the `barber` object) gains `categories: BarberCategoryTag[]`.

```jsonc
{
  "barber": {
    "id": "barber-uuid",
    "name": "John",
    "profileImage": null,
    "bio": "…",
    "address": "…",
    "phone": "…",
    "workingHours": [],
    "recurringAvailable": true,
    "categories": ["AFRO_HAIR_SPECIALIST", "BRAIDS"]
  }
  // services, reviews, reviewsSummary, distance, …
}
```

---

## Validation & Edge Cases

| Case | Handling |
|---|---|
| Invalid enum value | `400` from `@IsEnum(..., { each: true })` |
| Duplicate values | `400` from `@ArrayUnique()` |
| Empty array `[]` | Accepted — clears all categories |
| Step skipped / field omitted | Accepted — selection left empty |
| Existing barber without categories | Column default `'{}'` → empty array everywhere |
| `null` from DB | `normalizeCategories()` coerces to `[]` |
| Migration backfill | `in_house_services = true` → `IN_HOUSE_SERVICES` tag added |
| Filter with multiple categories | Array overlap (`&&`) → ANY match |

---

## Swagger / OpenAPI

- `BarberCategoryTag` is exposed as an `enum` (array) on every relevant DTO,
  so it renders as a multi-select dropdown.
- New DTOs documented: `BarberSignupCategoriesDto`, `UpdateBarberCategoriesDto`.
- Updated DTOs: `BarberProfileResponseDto`, `UpdateBarberProfileDto`,
  `BarberListItemDto`, `BarberInfoDto`, `BarberHomeResponseDto`,
  `ListBarbersQueryDto` (new `categories` query param).
