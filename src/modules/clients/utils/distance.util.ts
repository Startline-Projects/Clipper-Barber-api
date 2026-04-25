const EARTH_RADIUS_KM = 6371;
const KM_PER_MILE = 1.60934;

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export interface DistancePair {
  km: number;
  miles: number;
}

export function buildDistance(km: number): DistancePair {
  return {
    km: Number(km.toFixed(2)),
    miles: Number((km / KM_PER_MILE).toFixed(2)),
  };
}
