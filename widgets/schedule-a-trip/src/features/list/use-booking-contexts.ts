import { useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useAuthFetch, useBoClient } from '@vulog/bo-widget-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScheduledBooking } from '../../api/schedule-a-trip';
import { MAX_USER_IDS, type Customer } from '../../api/users';
import type { ListTab } from '../../domain/statuses';
import {
  bookingStateQueryOptions,
  customersQueryOptions,
  fleetBookingStatesQueryOptions,
} from '../../query/queries';
import { bookingsCollection, type BookingStateDoc, type FleetDocs } from '../../storage/booking-state';
import type { BookingContext } from '../extensions';

/** Where the customer of a row stands. */
export type CustomerStatus = 'loading' | 'ok' | 'missing' | 'error';

/** The rows of a tab with their extra data, and the state of that data. */
export interface BookingContexts {
  /** One context per booking, in order; a context keeps its identity until its data changes. */
  readonly contexts: readonly BookingContext[];
  readonly customerStatus: (userId: string | null) => CustomerStatus;
  /** Asks again the customers whose call failed. */
  readonly retryCustomers: () => void;
  /** The stored states could not be listed: `state` stays `undefined`. */
  readonly statesError: Error | null;
  readonly retryStates: () => void;
}

const NO_INVALID: FleetDocs['invalid'] = [];

/** Splits ids into chunks the users route takes. */
export const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
};

interface CustomerBatches {
  readonly byId: ReadonlyMap<string, Customer>;
  readonly settled: ReadonlySet<string>;
  readonly failed: ReadonlySet<string>;
  readonly retry: () => void;
}

/**
 * Loads the customers by batches of at most 100 ids: each id is asked for once, in the batch of the
 * rows that made it visible, so the keys of the batches stay the same while scrolling.
 */
function useCustomerBatches(fleetId: string, wanted: readonly string[]): CustomerBatches {
  const authFetch = useAuthFetch();
  const [batches, setBatches] = useState<{ fleetId: string; ids: string[][] }>({ fleetId, ids: [] });
  const current = batches.fleetId === fleetId ? batches.ids : [];

  useEffect(() => {
    setBatches((previous) => {
      const ids = previous.fleetId === fleetId ? previous.ids : [];
      const requested = new Set(ids.flat());
      const fresh = [...new Set(wanted)].filter((id) => !requested.has(id));
      if (fresh.length === 0 && previous.fleetId === fleetId) return previous;
      return { fleetId, ids: [...ids, ...chunk(fresh, MAX_USER_IDS)] };
    });
  }, [fleetId, wanted]);

  const combine = useCallback(
    (results: UseQueryResult<readonly Customer[]>[]) => {
      const byId = new Map<string, Customer>();
      const settled = new Set<string>();
      const failed = new Set<string>();
      results.forEach((result, index) => {
        const ids = current[index] ?? [];
        if (result.isError) ids.forEach((id) => failed.add(id));
        if (result.isSuccess) ids.forEach((id) => settled.add(id));
        for (const customer of result.data ?? []) byId.set(customer.id, customer);
      });
      return { byId, settled, failed, refetchers: results.map((result) => result.refetch) };
    },
    [current],
  );
  const combined = useQueries({
    queries: current.map((ids) => customersQueryOptions(authFetch, fleetId, ids)),
    combine,
  });
  const { refetchers, ...rest } = combined;
  const failedCount = rest.failed.size;
  const retry = useCallback(() => {
    if (failedCount > 0) refetchers.forEach((refetch) => void refetch());
  }, [refetchers, failedCount]);
  return { ...rest, retry };
}

/**
 * The stored state of each booking: the query of each booking state (the source a write of the
 * widget updates), seeded by one listing of the fleet, else the listing itself (a booking state
 * nobody watched may have been collected since). `undefined` until the listing is done, `null`
 * for a booking without a document.
 */
function useStates(fleetId: string, bookingIds: readonly string[]) {
  const bo = useBoClient();
  const queryClient = useQueryClient();
  const collection = useMemo(() => bookingsCollection(bo.storage), [bo]);
  const fleet = useQuery(fleetBookingStatesQueryOptions(queryClient, collection, fleetId));
  const listed = fleet.isSuccess;
  const docsById = useMemo(
    () => new Map((fleet.data?.docs ?? []).map((doc) => [doc.id, doc])),
    [fleet.data],
  );
  const combine = useCallback(
    (results: UseQueryResult<BookingStateDoc | null>[]) =>
      results.map((result, index) => {
        if (result.data !== undefined) return result.data;
        if (!listed) return undefined;
        return docsById.get(bookingIds[index] ?? '') ?? null;
      }),
    [listed, docsById, bookingIds],
  );
  const states = useQueries({
    queries: bookingIds.map((bookingId) => ({
      ...bookingStateQueryOptions(collection, fleetId, bookingId),
      // Filled by the listing and by the writes: never read one by one from the list.
      enabled: false,
    })),
    combine,
  });
  const invalid = fleet.data?.invalid ?? NO_INVALID;
  // A document that breaks the contract is shown as none: say which, never drop it silently.
  useEffect(() => {
    if (invalid.length > 0) {
      bo.log.warn('Booking states left out: they break the contract', {
        documents: invalid.map((doc) => ({ id: doc.id, issues: doc.issues })),
      });
    }
  }, [bo, invalid]);
  return {
    states,
    error: fleet.error,
    retry: () => void fleet.refetch(),
  };
}

/**
 * The context of each booking of a tab: the booking, its stored state and its customer. The
 * customers are loaded for the visible rows only, or for every row when `allCustomers` (a search
 * by name needs them).
 *
 * @param input - Fleet, tab, bookings, ids of the visible rows, and whether every customer is needed.
 * @returns The contexts and the state of their extra data.
 */
export function useBookingContexts(input: {
  readonly fleetId: string;
  readonly tab: ListTab;
  readonly bookings: readonly ScheduledBooking[];
  readonly visibleIds: ReadonlySet<string>;
  readonly allCustomers: boolean;
}): BookingContexts {
  const { fleetId, tab, bookings, visibleIds, allCustomers } = input;
  const wanted = useMemo(
    () =>
      bookings.flatMap((booking) =>
        booking.userId && (allCustomers || visibleIds.has(booking.id)) ? [booking.userId] : [],
      ),
    [bookings, visibleIds, allCustomers],
  );
  const customers = useCustomerBatches(fleetId, wanted);
  const bookingIds = useMemo(() => bookings.map((booking) => booking.id), [bookings]);
  const states = useStates(fleetId, bookingIds);

  const cache = useRef(new Map<string, BookingContext>());
  const contexts = useMemo(() => {
    const next = new Map<string, BookingContext>();
    const list = bookings.map((booking, index) => {
      const state = states.states[index];
      const customer = booking.userId ? customers.byId.get(booking.userId) : undefined;
      const previous = cache.current.get(booking.id);
      const context =
        previous &&
        previous.booking === booking &&
        previous.tab === tab &&
        previous.state === state &&
        previous.customer === customer
          ? previous
          : // Frozen: the grid memoizes the rows on these objects, a feature must never change one.
            Object.freeze({ booking, tab, state, customer });
      next.set(booking.id, context);
      return context;
    });
    cache.current = next;
    return list;
  }, [bookings, tab, states.states, customers.byId]);

  const { byId, settled, failed } = customers;
  const customerStatus = useCallback(
    (userId: string | null): CustomerStatus => {
      if (userId === null) return 'missing';
      if (byId.has(userId)) return 'ok';
      if (failed.has(userId)) return 'error';
      return settled.has(userId) ? 'missing' : 'loading';
    },
    [byId, settled, failed],
  );

  return {
    contexts,
    customerStatus,
    retryCustomers: customers.retry,
    statesError: states.error,
    retryStates: states.retry,
  };
}
