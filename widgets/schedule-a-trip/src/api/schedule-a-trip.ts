import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { z } from 'zod';
import type { AimaListStatus } from '../domain/statuses';
import { requestJson, segment, type ApiResult } from './http';

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
