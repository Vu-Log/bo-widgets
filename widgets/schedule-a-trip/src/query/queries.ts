import {
  infiniteQueryOptions,
  queryOptions,
  type Query,
  type QueryClient,
} from '@tanstack/react-query';
import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { getInvoice, type Invoice } from '../api/billing';
import { unwrap } from '../api/http';
import { reverseGeocode, type FetchLike } from '../api/mapbox';
import {
  getBookingRequest,
  listBookingRequests,
  MAX_BOOKING_PAGE_SIZE,
  type ScheduledBookingPage,
} from '../api/schedule-a-trip';
import { listUsersByIds } from '../api/users';
import {
  listLiveVehicles,
  listModels,
  listTripsInProgress,
  listVehicleCatalog,
} from '../api/vehicles';
import type { GeoPoint } from '../domain/vehicles-in-range';
import { aimaStatusOfTab, type ListTab } from '../domain/statuses';
import {
  listFleetDocs,
  readBookingState,
  StorageRequestError,
  type BookingStateCollection,
  type BookingStateDoc,
  type FleetDocs,
} from '../storage/booking-state';
import { PERSIST_MAX_AGE_MS } from './client';
import { queryKeys, type BookingListSort } from './keys';

const MINUTE = 60_000;

/** Rows of a page of the booking list. */
export const BOOKING_PAGE_SIZE = 50;

/**
 * The vehicle models of the fleet: reference data, fresh for 24 hours and persisted.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @returns Options for `useQuery`.
 */
export const modelsQueryOptions = (authFetch: AuthFetch, fleetId: string) =>
  queryOptions({
    queryKey: queryKeys.models(fleetId),
    queryFn: async ({ signal }) => unwrap(await listModels(authFetch, fleetId, signal)),
    staleTime: PERSIST_MAX_AGE_MS,
    // At least the persisted age: a query collected earlier would never be restored.
    gcTime: PERSIST_MAX_AGE_MS,
  });

/**
 * The bookings of a tab, page by page (from page 0), fresh for 30 seconds. Ongoing and Completed
 * both read the `CONFIRMED` bookings: split them with `tabOfBooking`.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param params - Fleet, tab, sort and page size.
 * @returns Options for `useInfiniteQuery`; `getNextPageParam` stops after the last page.
 */
export const bookingPagesQueryOptions = (
  authFetch: AuthFetch,
  params: {
    readonly fleetId: string;
    readonly tab: ListTab;
    readonly sort: BookingListSort;
    readonly pageSize?: number;
  },
) => {
  const size = params.pageSize ?? BOOKING_PAGE_SIZE;
  return infiniteQueryOptions({
    queryKey: queryKeys.bookings(params.fleetId, params.tab, params.sort),
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await listBookingRequests(
          authFetch,
          {
            fleetId: params.fleetId,
            status: aimaStatusOfTab(params.tab),
            page: pageParam,
            size,
            sort: params.sort,
          },
          signal,
        ),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage: ScheduledBookingPage, _pages, lastPageParam: number) => {
      if (lastPage.totalPages !== null) {
        return lastPageParam + 1 < lastPage.totalPages ? lastPageParam + 1 : undefined;
      }
      return lastPage.items.length < size ? undefined : lastPageParam + 1;
    },
    staleTime: 30_000,
  });
};

/**
 * Customers by id (at most 100): personal data, in memory only, fresh for 10 minutes.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param userIds - The ids of the visible rows.
 * @returns Options for `useQuery`.
 */
export const customersQueryOptions = (
  authFetch: AuthFetch,
  fleetId: string,
  userIds: readonly string[],
) =>
  queryOptions({
    queryKey: queryKeys.customers(fleetId, userIds),
    queryFn: async ({ signal }) =>
      unwrap(await listUsersByIds(authFetch, fleetId, userIds, signal)),
    staleTime: 10 * MINUTE,
  });

/**
 * How long an invoice status stays fresh: 1 minute, 5 once paid, for ever once refunded.
 *
 * @param query - The invoice query.
 * @returns The stale time in ms.
 */
export const invoiceStaleTime = (query: Pick<Query<Invoice>, 'state'>): number => {
  switch (query.state.data?.status) {
    case 'REFUNDED':
      return Number.POSITIVE_INFINITY;
    case 'PAID':
      return 5 * MINUTE;
    default:
      return MINUTE;
  }
};

/**
 * An invoice: a payment status, in memory only.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param invoiceId - The invoice.
 * @returns Options for `useQuery`.
 */
export const invoiceQueryOptions = (authFetch: AuthFetch, fleetId: string, invoiceId: string) =>
  queryOptions({
    queryKey: queryKeys.invoice(fleetId, invoiceId),
    queryFn: async ({ signal }) => unwrap(await getInvoice(authFetch, fleetId, invoiceId, signal)),
    staleTime: invoiceStaleTime,
  });

/**
 * The stored state of a booking. `null` (no document) is cached like any other value: never
 * fetched again in a loop. A storage failure is thrown as a `StorageRequestError`, never retried.
 *
 * @param collection - `bookingsCollection(bo.storage)`.
 * @param fleetId - The fleet.
 * @param bookingId - The AIMA booking id.
 * @returns Options for `useQuery`.
 */
export const bookingStateQueryOptions = (
  collection: BookingStateCollection,
  fleetId: string,
  bookingId: string,
) =>
  queryOptions({
    queryKey: queryKeys.bookingState(fleetId, bookingId),
    queryFn: async () => {
      const result = await readBookingState(collection, bookingId);
      if (!result.ok) throw new StorageRequestError(result.error);
      return result.value;
    },
    staleTime: 30_000,
  });

const HOUR = 60 * MINUTE;

/**
 * The number of bookings of a tab, from the totals of a page of one row (`totalelements`). For the
 * tabs listed page by page: Alert, Upcoming, Cancelled. `null` when the API gives no total.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param tab - The tab.
 * @returns Options for `useQuery`.
 */
export const bookingCountQueryOptions = (authFetch: AuthFetch, fleetId: string, tab: ListTab) =>
  queryOptions({
    queryKey: queryKeys.bookingCount(fleetId, tab),
    queryFn: async ({ signal }) =>
      unwrap(
        await listBookingRequests(
          authFetch,
          {
            fleetId,
            status: aimaStatusOfTab(tab),
            page: 0,
            size: 1,
            sort: { field: 'startDate', direction: 'ASC' },
          },
          signal,
        ),
      ).totalElements,
    staleTime: 30_000,
  });

/**
 * The `CONFIRMED` bookings of the fleet in one call of the largest page, latest start first, as the
 * back office reads them: the Ongoing tab keeps those whose trip is in progress.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @returns Options for `useQuery`.
 */
export const confirmedBookingsQueryOptions = (authFetch: AuthFetch, fleetId: string) =>
  queryOptions({
    queryKey: queryKeys.confirmedBookings(fleetId),
    queryFn: async ({ signal }) =>
      unwrap(
        await listBookingRequests(
          authFetch,
          {
            fleetId,
            status: 'CONFIRMED',
            page: 0,
            size: MAX_BOOKING_PAGE_SIZE,
            sort: { field: 'startDate', direction: 'DESC' },
          },
          signal,
        ),
      ),
    staleTime: 30_000,
  });

/**
 * One booking, for a deep link to a booking not loaded in the list.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param bookingId - The booking.
 * @returns Options for `useQuery`.
 */
export const bookingQueryOptions = (authFetch: AuthFetch, fleetId: string, bookingId: string) =>
  queryOptions({
    queryKey: queryKeys.booking(fleetId, bookingId),
    queryFn: async ({ signal }) =>
      unwrap(await getBookingRequest(authFetch, fleetId, bookingId, signal)),
    staleTime: 30_000,
  });

/**
 * The trips in progress of the fleet, which split Ongoing from Completed. Fresh for 30 seconds.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @returns Options for `useQuery`.
 */
export const tripsInProgressQueryOptions = (authFetch: AuthFetch, fleetId: string) =>
  queryOptions({
    queryKey: queryKeys.tripsInProgress(fleetId),
    queryFn: async ({ signal }) => unwrap(await listTripsInProgress(authFetch, fleetId, signal)),
    staleTime: 30_000,
  });

/**
 * The administrative data of the vehicles (plates, models, services): reference data, fresh for an
 * hour and persisted.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @returns Options for `useQuery`.
 */
export const vehicleCatalogQueryOptions = (authFetch: AuthFetch, fleetId: string) =>
  queryOptions({
    queryKey: queryKeys.vehicleCatalog(fleetId),
    queryFn: async ({ signal }) => unwrap(await listVehicleCatalog(authFetch, fleetId, signal)),
    staleTime: HOUR,
    gcTime: PERSIST_MAX_AGE_MS,
  });

/**
 * The live state of the vehicles (status, position, energy), in memory only, fresh for 30 seconds.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @returns Options for `useQuery`.
 */
export const liveVehiclesQueryOptions = (authFetch: AuthFetch, fleetId: string) =>
  queryOptions({
    queryKey: queryKeys.liveVehicles(fleetId),
    queryFn: async ({ signal }) => unwrap(await listLiveVehicles(authFetch, fleetId, signal)),
    staleTime: 30_000,
  });

/**
 * The address of the pickup point of a booking: personal data, in memory only, never fetched again
 * while cached.
 *
 * @param token - The public Mapbox token.
 * @param point - The point.
 * @param language - Language of the address.
 * @param fetcher - `fetch`, for the tests.
 * @returns Options for `useQuery`.
 */
export const bookingAddressQueryOptions = (
  token: string,
  point: GeoPoint,
  language: string,
  fetcher?: FetchLike,
) =>
  queryOptions({
    queryKey: queryKeys.bookingAddress(point.latitude, point.longitude, language),
    queryFn: async ({ signal }) =>
      unwrap(await reverseGeocode(token, point, language, fetcher, signal)),
    staleTime: Number.POSITIVE_INFINITY,
  });

/**
 * Writes the documents of a fleet listing into the query of each booking state, unless that query
 * already holds a newer version (written by the widget while the listing was on its way).
 *
 * @param queryClient - The query client.
 * @param fleetId - The fleet.
 * @param docs - The documents listed.
 */
export function seedBookingStates(
  queryClient: QueryClient,
  fleetId: string,
  docs: readonly BookingStateDoc[],
): void {
  for (const doc of docs) {
    const key = queryKeys.bookingState(fleetId, doc.id);
    const current = queryClient.getQueryData<BookingStateDoc | null>(key);
    if (current && current.version >= doc.version) continue;
    queryClient.setQueryData(key, doc);
  }
}

/**
 * Every stored state of the fleet, read in the background by pages of 100: the storage has no read
 * by ids. Each document is also written to the query of its booking ({@link seedBookingStates}),
 * which stays the source of a row. A storage failure is never retried.
 *
 * @param queryClient - The query client, to seed the booking states.
 * @param collection - `bookingsCollection(bo.storage)`.
 * @param fleetId - The fleet.
 * @returns Options for `useQuery`.
 */
export const fleetBookingStatesQueryOptions = (
  queryClient: QueryClient,
  collection: BookingStateCollection,
  fleetId: string,
) =>
  queryOptions({
    queryKey: queryKeys.fleetBookingStates(fleetId),
    queryFn: async (): Promise<FleetDocs> => {
      const result = await listFleetDocs(collection, fleetId);
      if (!result.ok) throw new StorageRequestError(result.error);
      seedBookingStates(queryClient, fleetId, result.value.docs);
      return result.value;
    },
    staleTime: 30_000,
  });
