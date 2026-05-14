/**
 * Barber category / specialty tags.
 *
 * Selected (optionally) by the barber during signup step 4 and editable
 * later from the barber profile. Used to describe a barber's services and
 * specialties and to filter barbers in client-facing listing APIs.
 *
 * `IN_HOUSE_SERVICES` is the categories-system representation of the legacy
 * `barbers.in_house_services` boolean — the migration backfills it for any
 * barber that already had the flag enabled.
 */
export enum BarberCategoryTag {
  ALL_GENDER_CUTS = 'ALL_GENDER_CUTS',
  KIDS_CUTS = 'KIDS_CUTS',
  CURLY_HAIR_SPECIALIST = 'CURLY_HAIR_SPECIALIST',
  AFRO_HAIR_SPECIALIST = 'AFRO_HAIR_SPECIALIST',
  BRAIDS = 'BRAIDS',
  BEARD_SPECIALIST = 'BEARD_SPECIALIST',
  SKIN_FADES = 'SKIN_FADES',
  WOMENS_HAIRCUTS = 'WOMENS_HAIRCUTS',
  LOCS_DREADLOCKS = 'LOCS_DREADLOCKS',
  HAIR_DESIGN = 'HAIR_DESIGN',
  SHAVES = 'SHAVES',
  MOBILE_BARBER = 'MOBILE_BARBER',
  IN_HOUSE_SERVICES = 'IN_HOUSE_SERVICES',
}

export const BARBER_CATEGORY_TAG_VALUES: BarberCategoryTag[] = Object.values(BarberCategoryTag);

/**
 * Normalises a raw categories input into a de-duplicated array of valid
 * enum values. Invalid entries are dropped here only as a defensive second
 * pass — DTO validation (`@IsEnum`) is the primary gate.
 */
export function normalizeCategories(
  input: readonly string[] | null | undefined
): BarberCategoryTag[] {
  if (!input || input.length === 0) return [];
  const valid = new Set<string>(BARBER_CATEGORY_TAG_VALUES);
  return Array.from(new Set(input)).filter((v): v is BarberCategoryTag => valid.has(v));
}
