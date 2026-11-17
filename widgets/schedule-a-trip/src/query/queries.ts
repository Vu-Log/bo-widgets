import { infiniteQueryOptions, queryOptions, type Query } from '@tanstack/react-query';
import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { getInvoice, type Invoice } from '../api/billing';
import { unwrap } from '../api/http';
import { listBookingRequests, type ScheduledBookingPage } from '../api/schedule-a-trip';
import { listUsersByIds } from '../api/users';
import { listModels } from '../api/vehicles';
import { aimaStatusOfTab, type ListTab } from '../domain/statuses';
import {
  readBookingState,
  StorageRequestError,
  type BookingStateCollection,
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
