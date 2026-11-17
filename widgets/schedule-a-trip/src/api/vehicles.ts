import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { z } from 'zod';
import { requestJson, segment, type ApiResult } from './http';

const modelSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  brand: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  status: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  vehicleType: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
});

/** A vehicle model of the fleet (ModelDTO), reduced to what the widget shows. */
export type VehicleModel = z.output<typeof modelSchema>;

/**
 * Lists the vehicle models of a fleet. `GET user/vehicle/fleets/{fleetId}/vehicles/models`.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param signal - Aborts the call.
 * @returns The models, or why the call failed.
 */
export async function listModels(
  authFetch: AuthFetch,
  fleetId: string,
  signal?: AbortSignal,
): Promise<ApiResult<readonly VehicleModel[]>> {
  const result = await requestJson(
    authFetch,
    `user/vehicle/fleets/${segment(fleetId)}/vehicles/models`,
    z.array(modelSchema),
    { signal },
  );
  return result.ok ? { ok: true, data: result.data.body } : result;
}

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);
const nullableNumber = z
  .number()
  .nullish()
  .transform((value) => value ?? null);

/** Rows of a page of the vehicle lists: the most the API gives in one call. */
export const VEHICLE_PAGE_SIZE = 2000;
/** Bound of the pages read, so that a wrong answer cannot loop: 100 000 vehicles. */
const MAX_VEHICLE_PAGES = 50;

/** Reads every page of a vehicle list, until a page has fewer rows than asked for. */
async function readAllPages<T>(
  readPage: (page: number) => Promise<ApiResult<readonly T[]>>,
): Promise<ApiResult<readonly T[]>> {
  const all: T[] = [];
  for (let page = 0; page < MAX_VEHICLE_PAGES; page++) {
    const result = await readPage(page);
    if (!result.ok) return result;
    all.push(...result.data);
    if (result.data.length < VEHICLE_PAGE_SIZE) return { ok: true, data: all };
  }
  return {
    ok: false,
    error: { kind: 'invalid-response', message: `More than ${MAX_VEHICLE_PAGES} pages` },
  };
}

const catalogVehicleSchema = z.object({
  id: z.string().min(1),
  name: nullableString,
  plate: nullableString,
  model: z
    .object({ id: z.number().int(), name: nullableString })
    .nullish()
    .transform((value) => value ?? null),
  serviceIds: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
});

/** A vehicle of the fleet, its administrative data (VehicleDTO): name, plate, model, services. */
export interface CatalogVehicle {
  readonly id: string;
  readonly name: string | null;
  readonly plate: string | null;
  readonly modelId: number | null;
  readonly modelName: string | null;
  /** The services the vehicle can be booked on. */
  readonly serviceIds: readonly string[];
}

/**
 * Lists the administrative data of the vehicles of a fleet, every page.
 * `GET user/vehicle/fleets/{fleetId}/vehicles?page&size` (reference: admin-vehicle).
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param signal - Aborts the calls.
 * @returns Every vehicle, or why a page failed.
 */
export async function listVehicleCatalog(
  authFetch: AuthFetch,
  fleetId: string,
  signal?: AbortSignal,
): Promise<ApiResult<readonly CatalogVehicle[]>> {
  return readAllPages(async (page) => {
    const result = await requestJson(
      authFetch,
      `user/vehicle/fleets/${segment(fleetId)}/vehicles?page=${page}&size=${VEHICLE_PAGE_SIZE}`,
      z.array(catalogVehicleSchema),
      { signal },
    );
    if (!result.ok) return result;
    return {
      ok: true,
      data: result.data.body.map((vehicle) => ({
        id: vehicle.id,
        name: vehicle.name,
        plate: vehicle.plate,
        modelId: vehicle.model?.id ?? null,
        modelName: vehicle.model?.name ?? null,
        serviceIds: vehicle.serviceIds,
      })),
    };
  });
}

/** Status of a vehicle in the fleet, from `vehicle_status` of the fleet manager. */
export type VehicleStatus = 'AVAILABLE' | 'IN_USE' | 'OUT_OF_SERVICE' | 'ARCHIVED' | 'UNKNOWN';

const VEHICLE_STATUSES: Readonly<Record<number, VehicleStatus>> = {
  0: 'AVAILABLE',
  1: 'IN_USE',
  2: 'OUT_OF_SERVICE',
  3: 'ARCHIVED',
};

/**
 * The status of a `vehicle_status` code: 0 available, 1 in use, 2 out of service, 3 archived,
 * `UNKNOWN` for any other code or none.
 *
 * @param code - `vehicle_status` of a VehicleFM.
 * @returns The status.
 */
export const vehicleStatusOf = (code: number | null): VehicleStatus =>
  (code === null ? undefined : VEHICLE_STATUSES[code]) ?? 'UNKNOWN';

const coordinate = z
  .number()
  .finite()
  .nullish()
  .transform((value) => value ?? null);

const liveVehicleSchema = z.object({
  id: z.string().min(1),
  plate: nullableString,
  vehicle_status: nullableNumber,
  location: z
    .object({ latitude: coordinate, longitude: coordinate })
    .nullish()
    .transform((value) => value ?? null),
  autonomy: nullableNumber,
  energyLevel: nullableNumber,
  km: nullableNumber,
  outOfServiceReason: nullableString,
  orderId: nullableString,
});

/** The live state of a vehicle (VehicleFM), reduced to what the vehicle picker shows. */
export interface LiveVehicle {
  readonly id: string;
  readonly plate: string | null;
  readonly status: VehicleStatus;
  /** `null` when the vehicle is not located. */
  readonly location: { readonly latitude: number; readonly longitude: number } | null;
  readonly autonomy: number | null;
  /** Energy left, in %. */
  readonly energyLevel: number | null;
  readonly km: number | null;
  /** Why it is out of service (its sub-status), when it is. */
  readonly outOfServiceReason: string | null;
  /** Trip in progress on the vehicle, if any. */
  readonly tripId: string | null;
}

const toLiveVehicle = (vehicle: z.output<typeof liveVehicleSchema>): LiveVehicle => {
  const { latitude, longitude } = vehicle.location ?? { latitude: null, longitude: null };
  return {
    id: vehicle.id,
    plate: vehicle.plate,
    status: vehicleStatusOf(vehicle.vehicle_status),
    location: latitude === null || longitude === null ? null : { latitude, longitude },
    autonomy: vehicle.autonomy,
    energyLevel: vehicle.energyLevel,
    km: vehicle.km,
    outOfServiceReason: vehicle.outOfServiceReason,
    tripId: vehicle.orderId,
  };
};

/**
 * Lists the live state of the vehicles of a fleet (status, position, energy), every page.
 * `GET fleetmanager/public/fleets/{fleetId}/vehicles?page&size` (reference: admin-fleet; the back
 * office asks for pages of 2 000, the most the route gives).
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param signal - Aborts the calls.
 * @returns Every vehicle, or why a page failed.
 */
export async function listLiveVehicles(
  authFetch: AuthFetch,
  fleetId: string,
  signal?: AbortSignal,
): Promise<ApiResult<readonly LiveVehicle[]>> {
  return readAllPages(async (page) => {
    const result = await requestJson(
      authFetch,
      `fleetmanager/public/fleets/${segment(fleetId)}/vehicles?page=${page}&size=${VEHICLE_PAGE_SIZE}`,
      z.array(liveVehicleSchema),
      { signal },
    );
    return result.ok ? { ok: true, data: result.data.body.map(toLiveVehicle) } : result;
  });
}

/** A trip in progress in the fleet: its id (the `journeyId` of a booking) and its vehicle. */
export interface TripInProgress {
  readonly tripId: string;
  readonly vehicleId: string;
  readonly plate: string | null;
}

/**
 * Lists the trips in progress of a fleet, from the vehicles booked.
 * `GET fleetmanager/public/fleets/{fleetId}/book` (reference: admin-fleet). A `404` means no
 * vehicle is booked, as the back office reads it; any other failure is one.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param signal - Aborts the call.
 * @returns The trips, `[]` when none, or why the call failed.
 */
export async function listTripsInProgress(
  authFetch: AuthFetch,
  fleetId: string,
  signal?: AbortSignal,
): Promise<ApiResult<readonly TripInProgress[]>> {
  const result = await requestJson(
    authFetch,
    `fleetmanager/public/fleets/${segment(fleetId)}/book`,
    z.array(liveVehicleSchema),
    { signal },
  );
  if (!result.ok) return result.error.kind === 'not-found' ? { ok: true, data: [] } : result;
  return {
    ok: true,
    data: result.data.body.flatMap((vehicle) =>
      vehicle.orderId ? [{ tripId: vehicle.orderId, vehicleId: vehicle.id, plate: vehicle.plate }] : [],
    ),
  };
}
