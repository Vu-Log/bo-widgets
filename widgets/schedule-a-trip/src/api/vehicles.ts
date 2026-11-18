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
