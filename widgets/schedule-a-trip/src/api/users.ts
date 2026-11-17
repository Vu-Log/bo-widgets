import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { z } from 'zod';
import { requestJson, segment, type ApiResult } from './http';

/** Most ids `user/fleets/{fleetId}/users/list` takes in one call. */
export const MAX_USER_IDS = 100;

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

// Only these fields are read: the answer (UserPIDTO) also holds birth date, address, emails…,
// which the widget never keeps.
const userSchema = z.object({
  id: z.string().min(1),
  firstName: nullableString,
  lastName: nullableString,
  userName: nullableString,
  profiles: z
    .array(
      z.object({
        id: nullableString,
        type: nullableString,
        entity: z.object({ id: nullableString }).nullish(),
      }),
    )
    .nullish(),
});

/** A profile of a customer: its id, its type (`Single`, `Business`…) and the entity billed. */
export interface CustomerProfile {
  /** The `profileId` of the bookings made with it; `null` when the API does not give it. */
  readonly id: string | null;
  readonly type: string | null;
  readonly entityId: string | null;
}

/** A customer of a booking, reduced to what the widget shows and needs to bill. */
export interface Customer {
  readonly id: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly userName: string | null;
  readonly profiles: readonly CustomerProfile[];
}

/**
 * Reads customers by id. `POST user/fleets/{fleetId}/users/list`, body `string[]`. Keeps only the
 * id, the names, the user name and, per profile, its id, type and entity id: no other personal data.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param userIds - 0 to {@link MAX_USER_IDS} ids; duplicates are sent once. None resolves `[]`
 *   without a call.
 * @param signal - Aborts the call.
 * @returns The customers found (an unknown id is left out), or why the call failed.
 */
export async function listUsersByIds(
  authFetch: AuthFetch,
  fleetId: string,
  userIds: readonly string[],
  signal?: AbortSignal,
): Promise<ApiResult<readonly Customer[]>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return { ok: true, data: [] };
  if (ids.length > MAX_USER_IDS) {
    return {
      ok: false,
      error: {
        kind: 'invalid-request',
        message: `At most ${MAX_USER_IDS} users per call, got ${ids.length}`,
      },
    };
  }
  const result = await requestJson(
    authFetch,
    `user/fleets/${segment(fleetId)}/users/list`,
    z.array(userSchema),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids),
      signal,
    },
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.body.map((user) => ({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      userName: user.userName,
      profiles: (user.profiles ?? []).map((profile) => ({
        id: profile.id,
        type: profile.type,
        entityId: profile.entity?.id ?? null,
      })),
    })),
  };
}
