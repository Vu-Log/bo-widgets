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

/** A customer found by the search of the back office. */
export interface CustomerMatch {
  readonly id: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly userName: string | null;
}

const searchSchema = z.array(
  z.looseObject({
    type: z.string().nullish(),
    id: z.string().nullish(),
    firstname: nullableString,
    lastname: nullableString,
    username: nullableString,
  }),
);

/**
 * Finds customers by name, user name, email or phone, with the search of the back office.
 * `GET search/fleets/{fleetId}/search/{text}`: the route the back office calls for its search (not
 * in the public reference). Spaces are removed from a phone number, as the back office does. A
 * `404` means nothing was found. Only the users are kept, with their names: never other data.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param text - What the operator typed; a blank text resolves `[]` without a call.
 * @param signal - Aborts the call.
 * @returns The customers found, or why the call failed.
 */
export async function searchCustomers(
  authFetch: AuthFetch,
  fleetId: string,
  text: string,
  signal?: AbortSignal,
): Promise<ApiResult<readonly CustomerMatch[]>> {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, data: [] };
  const query = /^\+?[\d\s]+$/.test(trimmed) ? trimmed.replace(/\s/g, '') : trimmed;
  const result = await requestJson(
    authFetch,
    `search/fleets/${segment(fleetId)}/search/${segment(query)}`,
    searchSchema,
    { signal },
  );
  if (!result.ok) return result.error.kind === 'not-found' ? { ok: true, data: [] } : result;
  return {
    ok: true,
    data: result.data.body.flatMap((entry) =>
      entry.type === 'user' && entry.id
        ? [{ id: entry.id, firstName: entry.firstname, lastName: entry.lastname, userName: entry.username }]
        : [],
    ),
  };
}

/** A type of profile: the known ones, open to others the API may add. */
export type ProfileType = 'Single' | 'Business' | 'Family' | (string & {});
/** A status of profile: the known ones, open to others. */
export type ProfileStatus = 'APPROVED' | 'PENDING' | 'SUSPENDED' | 'REJECTED' | 'INACTIVE' | 'ARCHIVED' | (string & {});
/** A type of service: the known ones, open to others. */
export type ServiceType = 'FREE_FLOATING' | 'BOOKING' | 'SERVICE_TRIP' | 'SUBSCRIPTION' | (string & {});

/** A profile of a customer and the services approved for it. */
export interface RegisteredProfile {
  readonly profileId: string;
  readonly type: ProfileType;
  readonly status: ProfileStatus;
  readonly approvedServiceIds: readonly string[];
}

/** A service of the catalogue of a customer. */
export interface RegisteredService {
  readonly id: string;
  readonly name: string;
  readonly type: ServiceType;
  readonly fleetId: string;
  readonly cityId: string;
}

/** The profiles of a customer and the services they can book. */
export interface RegistrationOverview {
  readonly profiles: readonly RegisteredProfile[];
  readonly services: readonly RegisteredService[];
}

const overviewSchema = z.array(
  z.object({
    catalog: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          type: z.string(),
          fleetId: z.string(),
          cityId: z.string(),
        }),
      )
      .nullish(),
    profiles: z
      .array(
        z.object({
          profileId: z.string(),
          profileType: z.string(),
          profileStatus: z.string(),
          services: z.object({ approved: z.array(z.string()).nullish() }).nullish(),
        }),
      )
      .nullish(),
  }),
);

/**
 * The profiles of a customer and the services approved for each.
 * `GET user/fleets/{fleetId}/serviceRegistrationOverview?userId=` (reference: admin-user).
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param userId - The customer.
 * @param signal - Aborts the call.
 * @returns The profiles and the services, empty for an unknown customer, or why the call failed.
 */
export async function getRegistrationOverview(
  authFetch: AuthFetch,
  fleetId: string,
  userId: string,
  signal?: AbortSignal,
): Promise<ApiResult<RegistrationOverview>> {
  const result = await requestJson(
    authFetch,
    `user/fleets/${segment(fleetId)}/serviceRegistrationOverview?${new URLSearchParams({ userId })}`,
    overviewSchema,
    { signal },
  );
  if (!result.ok) return result;
  const first = result.data.body[0];
  return {
    ok: true,
    data: {
      profiles: (first?.profiles ?? []).map((profile) => ({
        profileId: profile.profileId,
        type: profile.profileType,
        status: profile.profileStatus,
        approvedServiceIds: profile.services?.approved ?? [],
      })),
      services: first?.catalog ?? [],
    },
  };
}
