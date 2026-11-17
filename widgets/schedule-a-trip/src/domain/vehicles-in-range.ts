/** A point on the map. */
export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

/** What {@link vehiclesInRange} reads of a vehicle. */
export interface CandidateVehicle {
  readonly id: string;
  /** Status of the vehicle in the fleet (`AVAILABLE`…). */
  readonly status: string | null;
  readonly serviceId: string | null;
  readonly modelId: number | null;
  /** `null` when the vehicle is not located. */
  readonly location: GeoPoint | null;
}

/** The vehicles a booking can get. */
export interface VehicleSearch {
  readonly serviceId: string;
  /** The model of the booking, or `'any'`. */
  readonly modelId: number | 'any';
  /** The pickup point. */
  readonly center: GeoPoint;
  /** Radius of the pickup zone, in meters. */
  readonly radiusMeters: number;
}

/** A vehicle with its distance to the pickup point. */
export type VehicleWithDistance<V> = V & { readonly distanceMeters: number };

/** The vehicles in the pickup zone, and the closest ones outside of it. */
export interface VehiclesInRange<V> {
  /** Every vehicle in the zone, closest first. */
  readonly inRange: readonly VehicleWithDistance<V>[];
  /** The {@link OUT_OF_RANGE_LIMIT} closest vehicles outside the zone, closest first. */
  readonly closestOutOfRange: readonly VehicleWithDistance<V>[];
}

/** How many vehicles outside the zone are proposed. */
export const OUT_OF_RANGE_LIMIT = 10;

const EARTH_RADIUS_METERS = 6_371_008.8;
const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * The great-circle distance between two points (haversine formula).
 *
 * @param from - A point.
 * @param to - Another point.
 * @returns The distance in meters.
 */
export function haversineMeters(from: GeoPoint, to: GeoPoint): number {
  const dLat = radians(to.latitude - from.latitude);
  const dLon = radians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * The vehicles a booking can be given: `AVAILABLE`, located, of the service of the booking and of
 * its model (any model with `'any'`), split between the pickup zone and the closest ones outside.
 *
 * @param vehicles - The vehicles of the fleet.
 * @param search - Service, model, pickup point and radius.
 * @returns The vehicles in range and the closest out of range, each sorted by distance.
 */
export function vehiclesInRange<V extends CandidateVehicle>(
  vehicles: readonly V[],
  search: VehicleSearch,
): VehiclesInRange<V> {
  const candidates = vehicles
    .flatMap((vehicle) =>
      vehicle.status === 'AVAILABLE' &&
      vehicle.location !== null &&
      vehicle.serviceId === search.serviceId &&
      (search.modelId === 'any' || vehicle.modelId === search.modelId)
        ? [{ ...vehicle, distanceMeters: haversineMeters(search.center, vehicle.location) }]
        : [],
    )
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
  return {
    inRange: candidates.filter((vehicle) => vehicle.distanceMeters <= search.radiusMeters),
    closestOutOfRange: candidates
      .filter((vehicle) => vehicle.distanceMeters > search.radiusMeters)
      .slice(0, OUT_OF_RANGE_LIMIT),
  };
}
