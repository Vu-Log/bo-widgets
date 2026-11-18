import type { CandidateVehicle } from './vehicles-in-range';

/** What {@link candidateVehicles} reads of the administrative data of a vehicle. */
export interface CatalogEntry {
  readonly id: string;
  readonly name: string | null;
  readonly plate: string | null;
  readonly modelId: number | null;
  readonly modelName: string | null;
  readonly serviceIds: readonly string[];
}

/** What {@link candidateVehicles} reads of the live state of a vehicle. */
export interface LiveEntry {
  readonly id: string;
  readonly plate: string | null;
  readonly status: string;
  readonly location: { readonly latitude: number; readonly longitude: number } | null;
  readonly autonomy: number | null;
  readonly energyLevel: number | null;
  readonly km: number | null;
}

/** A vehicle a booking may get, with what the picker shows. */
export interface VehicleCandidate extends CandidateVehicle {
  readonly name: string | null;
  readonly plate: string | null;
  readonly modelName: string | null;
  readonly autonomy: number | null;
  readonly energyLevel: number | null;
  readonly km: number | null;
}

/**
 * Joins the administrative data and the live state of the vehicles into the input of
 * `vehiclesInRange` for one service: a vehicle that belongs to the service gets it as its
 * `serviceId` (a vehicle may belong to several), any other gets `null`. Vehicles without live
 * state are left out: no status nor position.
 *
 * @param catalog - The administrative data (`user/vehicle/.../vehicles`).
 * @param live - The live state (`fleetmanager/.../vehicles`).
 * @param serviceId - The service of the booking.
 * @returns The candidates, in the order of `live`.
 */
export function candidateVehicles(
  catalog: readonly CatalogEntry[],
  live: readonly LiveEntry[],
  serviceId: string,
): VehicleCandidate[] {
  const byId = new Map(catalog.map((vehicle) => [vehicle.id, vehicle]));
  return live.map((vehicle) => {
    const admin = byId.get(vehicle.id);
    return {
      id: vehicle.id,
      status: vehicle.status,
      serviceId: admin?.serviceIds.includes(serviceId) ? serviceId : null,
      modelId: admin?.modelId ?? null,
      location: vehicle.location,
      name: admin?.name ?? null,
      plate: admin?.plate ?? vehicle.plate,
      modelName: admin?.modelName ?? null,
      autonomy: vehicle.autonomy,
      energyLevel: vehicle.energyLevel,
      km: vehicle.km,
    };
  });
}
