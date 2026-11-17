import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { z } from 'zod';
import type { Pickup } from '../domain/booking-dates';
import type { AimaListStatus } from '../domain/statuses';
import { requestJson, requestNoContent, segment, type ApiResult } from './http';

/*
 * The `user/scheduleATrip/fleets/{fleetId}/bookingrequests` routes are called by the back office
 * with the token of the operator, but they are absent from the public Vulog API reference (only
 * `.../bookingrequests/users/{userId}/active` is there). Their shape below follows what the back
 * office reads; keep it to the fields the widget needs.
 */

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);
/** A date the domain functions can read: an unreadable one is an unexpected response. */
const date = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date');
const nullableDate = date.nullish().transform((value) => value ?? null);
const nullableNumber = z
  .number()
  .nullish()
  .transform((value) => value ?? null);

const scheduledBookingSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  creationDate: nullableDate,
  startDate: date,
  endDate: nullableDate,
  plannedReturnDate: nullableDate,
  cancellationDate: nullableDate,
  userId: nullableString,
  profileId: nullableString,
  serviceId: nullableString,
  modelId: nullableNumber,
  vehicleId: nullableString,
  journeyId: nullableString,
  completed: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
  latitude: nullableNumber,
  longitude: nullableNumber,
  radius: nullableNumber,
  notes: nullableString,
  failureReason: nullableString,
});

/** A Schedule a trip booking (booking request), as the list routes return it. */
export type ScheduledBooking = z.output<typeof scheduledBookingSchema>;

/** One page of a booking list, with the totals the API gives in its headers. */
export interface ScheduledBookingPage {
  readonly items: readonly ScheduledBooking[];
  /** Header `totalelements`; `null` when absent or unreadable. */
  readonly totalElements: number | null;
  /** Header `totalpages`; `null` when absent or unreadable. */
  readonly totalPages: number | null;
}

/** What to list: a status, a page (from 0), a size and a sort. */
export interface ListBookingRequestsParams {
  readonly fleetId: string;
  readonly status: AimaListStatus;
  readonly page: number;
  readonly size: number;
  readonly sort: { readonly field: string; readonly direction: 'ASC' | 'DESC' };
}

/** Largest page the widget asks for. */
export const MAX_BOOKING_PAGE_SIZE = 2000;

const headerNumber = (headers: Headers, name: string): number | null => {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
};

/**
 * Lists the Schedule a trip bookings of a fleet with one AIMA status, one page at a time.
 * `GET user/scheduleATrip/fleets/{fleetId}/bookingrequests/status/{status}?page&size&sort=field,DIR`.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param params - Fleet, status, page (from 0), size (1 to {@link MAX_BOOKING_PAGE_SIZE}) and sort.
 * @param signal - Aborts the call.
 * @returns The page and the totals of the headers `totalelements` and `totalpages`.
 */
export async function listBookingRequests(
  authFetch: AuthFetch,
  params: ListBookingRequestsParams,
  signal?: AbortSignal,
): Promise<ApiResult<ScheduledBookingPage>> {
  const { fleetId, status, page, size, sort } = params;
  if (!Number.isInteger(page) || page < 0) {
    return { ok: false, error: { kind: 'invalid-request', message: `Invalid page: ${page}` } };
  }
  if (!Number.isInteger(size) || size < 1 || size > MAX_BOOKING_PAGE_SIZE) {
    return { ok: false, error: { kind: 'invalid-request', message: `Invalid page size: ${size}` } };
  }
  if (!/^[A-Za-z][A-Za-z0-9_.]*$/.test(sort.field)) {
    return {
      ok: false,
      error: { kind: 'invalid-request', message: `Invalid sort field: ${sort.field}` },
    };
  }
  const query = new URLSearchParams({
    page: String(page),
    size: String(size),
    sort: `${sort.field},${sort.direction}`,
  });
  const result = await requestJson(
    authFetch,
    `user/scheduleATrip/fleets/${segment(fleetId)}/bookingrequests/status/${segment(status)}?${query}`,
    z.array(scheduledBookingSchema),
    { signal },
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      items: result.data.body,
      totalElements: headerNumber(result.data.headers, 'totalelements'),
      totalPages: headerNumber(result.data.headers, 'totalpages'),
    },
  };
}

/**
 * Reads one Schedule a trip booking, with the shape of the list routes.
 * `GET user/scheduleATrip/fleets/{fleetId}/bookingrequests/{id}`: the route the back office calls to
 * read a booking again after a change (not in the public reference either).
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param bookingId - The booking.
 * @param signal - Aborts the call.
 * @returns The booking, `not-found` when it does not exist, or why the call failed.
 */
export async function getBookingRequest(
  authFetch: AuthFetch,
  fleetId: string,
  bookingId: string,
  signal?: AbortSignal,
): Promise<ApiResult<ScheduledBooking>> {
  const result = await requestJson(
    authFetch,
    `user/scheduleATrip/fleets/${segment(fleetId)}/bookingrequests/${segment(bookingId)}`,
    scheduledBookingSchema,
    { signal },
  );
  return result.ok ? { ok: true, data: result.data.body } : result;
}

/*
 * Writes. The paths and bodies are those the back office uses for its own Schedule a trip page
 * (`ScheduleATripClient`, `BookingRequestClient`): create, update, cancel, allocate; the deallocation
 * goes through `user/scheduledBooking/...`. Their answers are not read: the widget reads the booking
 * again, as the back office does.
 */

const bookingRequestsPath = (fleetId: string) =>
  `user/scheduleATrip/fleets/${segment(fleetId)}/bookingrequests`;

/** A date as the Schedule a trip routes take it: UTC, to the second (`2026-03-10T08:00:00Z`). */
export const toApiDate = (date: Date): string => `${date.toISOString().slice(0, 19)}Z`;

/** What a new Schedule a trip booking needs. */
export interface NewBookingRequest {
  readonly userId: string;
  readonly profileId: string;
  readonly serviceId: string;
  readonly cityId: string;
  readonly start: Date;
  /** `null` without a planned return. */
  readonly plannedReturn: Date | null;
  /** `null` for any model. */
  readonly modelId: number | null;
  readonly latitude: number;
  readonly longitude: number;
  /** Radius of the pickup zone, in meters. */
  readonly radius: number;
  readonly notes: string;
}

/**
 * Creates a Schedule a trip booking, confirmed at once.
 * `POST user/scheduleATrip/fleets/{fleetId}/bookingrequests` (route of the back office).
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param input - Customer, profile, service, dates, model, pickup point and notes.
 * @returns The id of the new booking, or why the call failed.
 */
export async function createBookingRequest(
  authFetch: AuthFetch,
  fleetId: string,
  input: NewBookingRequest,
): Promise<ApiResult<string>> {
  const result = await requestJson(
    authFetch,
    bookingRequestsPath(fleetId),
    z.object({ id: z.string().min(1) }),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cityId: input.cityId,
        latitude: input.latitude,
        longitude: input.longitude,
        profileId: input.profileId,
        radius: input.radius,
        serviceId: input.serviceId,
        startDate: toApiDate(input.start),
        plannedReturnDate: input.plannedReturn === null ? null : toApiDate(input.plannedReturn),
        status: 'CONFIRMED',
        userId: input.userId,
        warning: '',
        notes: input.notes,
        modelId: input.modelId,
      }),
    },
  );
  return result.ok ? { ok: true, data: result.data.body.id } : result;
}

/**
 * The fields of a booking the widget changes; the others are left as they are. `plannedReturn:
 * null` removes the planned return. The pickup point is sent whole: both coordinates and the
 * radius.
 */
export interface BookingRequestChanges {
  readonly start?: Date;
  readonly plannedReturn?: Date | null;
  readonly notes?: string;
  readonly pickup?: Pickup;
}

/**
 * Changes a Schedule a trip booking. `POST user/scheduleATrip/fleets/{fleetId}/bookingrequests/{id}`
 * (route of the back office), with the fields changed only. `modelId` is always sent: the API sets
 * the model to "any" when it is absent.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param bookingId - The booking.
 * @param modelId - The model of the booking after the change, `null` for any model.
 * @param changes - The fields to change.
 * @returns `ok`, or why the call failed.
 */
export function updateBookingRequest(
  authFetch: AuthFetch,
  fleetId: string,
  bookingId: string,
  modelId: number | null,
  changes: BookingRequestChanges,
): Promise<ApiResult<null>> {
  const body: Record<string, unknown> = { id: bookingId, modelId };
  if (changes.start !== undefined) body.startDate = toApiDate(changes.start);
  if (changes.plannedReturn !== undefined) {
    body.plannedReturnDate = changes.plannedReturn === null ? null : toApiDate(changes.plannedReturn);
  }
  if (changes.notes !== undefined) body.notes = changes.notes;
  if (changes.pickup !== undefined) {
    body.latitude = changes.pickup.latitude;
    body.longitude = changes.pickup.longitude;
    body.radius = changes.pickup.radius;
  }
  return requestNoContent(authFetch, `${bookingRequestsPath(fleetId)}/${segment(bookingId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Cancels a Schedule a trip booking. `POST user/scheduleATrip/fleets/{fleetId}/bookingrequests/cancel/{id}`
 * (route of the back office).
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param bookingId - The booking.
 * @returns `ok`, or why the call failed.
 */
export const cancelBookingRequest = (
  authFetch: AuthFetch,
  fleetId: string,
  bookingId: string,
): Promise<ApiResult<null>> =>
  requestNoContent(authFetch, `${bookingRequestsPath(fleetId)}/cancel/${segment(bookingId)}`, {
    method: 'POST',
  });

/**
 * Allocates a vehicle to a booking. `POST user/scheduleATrip/fleets/{fleetId}/bookingrequests/{id}/allocate/{vehicleId}?serviceId=`
 * (route of the back office).
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param bookingId - The booking.
 * @param vehicleId - The vehicle.
 * @param serviceId - The service of the booking, which the vehicle belongs to.
 * @returns `ok`, or why the call failed.
 */
export const allocateVehicle = (
  authFetch: AuthFetch,
  fleetId: string,
  bookingId: string,
  vehicleId: string,
  serviceId: string,
): Promise<ApiResult<null>> =>
  requestNoContent(
    authFetch,
    `${bookingRequestsPath(fleetId)}/${segment(bookingId)}/allocate/${segment(vehicleId)}?${new URLSearchParams({ serviceId })}`,
    { method: 'POST' },
  );

/**
 * Takes its vehicle back from a booking.
 * `DELETE user/scheduledBooking/fleets/{fleetId}/bookingrequests/{id}/vehicles/{vehicleId}` (route of
 * the back office).
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param bookingId - The booking.
 * @param vehicleId - Its vehicle.
 * @returns `ok`, or why the call failed.
 */
export const deallocateVehicle = (
  authFetch: AuthFetch,
  fleetId: string,
  bookingId: string,
  vehicleId: string,
): Promise<ApiResult<null>> =>
  requestNoContent(
    authFetch,
    `user/scheduledBooking/fleets/${segment(fleetId)}/bookingrequests/${segment(bookingId)}/vehicles/${segment(vehicleId)}`,
    { method: 'DELETE' },
  );

/**
 * Whether a customer has a booking in progress: the back office refuses to allocate a vehicle then.
 * `GET user/scheduleATrip/fleets/{fleetId}/bookingrequests/users/{userId}/active` (reference:
 * admin-booking).
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param userId - The customer.
 * @param signal - Aborts the call.
 * @returns `true` when one of the active bookings has a trip, or why the call failed.
 */
export async function hasTripInProgress(
  authFetch: AuthFetch,
  fleetId: string,
  userId: string,
  signal?: AbortSignal,
): Promise<ApiResult<boolean>> {
  const result = await requestJson(
    authFetch,
    `${bookingRequestsPath(fleetId)}/users/${segment(userId)}/active`,
    z.array(z.object({ journeyId: nullableString })),
    { signal },
  );
  if (!result.ok) return result;
  return { ok: true, data: result.data.body.some((booking) => booking.journeyId !== null) };
}
