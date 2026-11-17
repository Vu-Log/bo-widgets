import { useQuery } from '@tanstack/react-query';
import { useAuthFetch, useBoClient } from '@vulog/bo-widget-react';
import { useMemo } from 'react';
import type { ScheduledBooking } from '../../api/schedule-a-trip';
import { tabOfBooking, type ListTab } from '../../domain/statuses';
import {
  bookingQueryOptions,
  bookingStateQueryOptions,
  customersQueryOptions,
  tripsInProgressQueryOptions,
} from '../../query/queries';
import { bookingsCollection } from '../../storage/booking-state';
import type { BookingContext } from '../extensions';
import type { CustomerStatus } from '../list/use-booking-contexts';

/** The booking of the detail drawer, with its own reads. */
export interface DetailContext {
  /** `null` while the booking of a deep link loads, or when it failed. */
  readonly ctx: BookingContext | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly customerStatus: CustomerStatus;
}

/**
 * The tab of a booking read alone: from the trips in progress for a `CONFIRMED` one (from its
 * completion while they load), from its status otherwise.
 *
 * @param booking - The booking.
 * @param tripIds - Ids of the trips in progress, `null` while they load.
 * @returns The tab.
 */
export function tabOfDetail(booking: ScheduledBooking, tripIds: ReadonlySet<string> | null): ListTab {
  const tab = tripIds === null ? null : tabOfBooking(booking, tripIds);
  if (tab) return tab;
  if (booking.status === 'CONFIRMED') return booking.completed ? 'completed' : 'ongoing';
  if (booking.status === 'CANCELLED') return 'cancelled';
  return booking.status === 'ALERT' ? 'alert' : 'upcoming';
}

/**
 * The context of the open booking: the row of the list when it is there, else the booking read by
 * id (a deep link). Its customer and its stored state are read again for the drawer, so that a row
 * not enriched yet (reached with ↑/↓) shows them too.
 *
 * @param fleetId - The fleet.
 * @param bookingId - The open booking.
 * @param fromList - Its row in the list, if loaded.
 * @returns The context and the state of its reads.
 */
export function useDetailContext(
  fleetId: string,
  bookingId: string,
  fromList: BookingContext | undefined,
): DetailContext {
  const authFetch = useAuthFetch();
  const bo = useBoClient();
  const collection = useMemo(() => bookingsCollection(bo.storage), [bo]);
  const single = useQuery({
    ...bookingQueryOptions(authFetch, fleetId, bookingId),
    enabled: fromList === undefined,
  });
  const booking = fromList?.booking ?? single.data;
  const confirmed = booking?.status === 'CONFIRMED';
  const trips = useQuery({
    ...tripsInProgressQueryOptions(authFetch, fleetId),
    enabled: fromList === undefined && confirmed,
  });
  const userIds = booking?.userId ? [booking.userId] : [];
  const customers = useQuery({
    ...customersQueryOptions(authFetch, fleetId, userIds),
    enabled: userIds.length > 0 && fromList?.customer === undefined,
  });
  const state = useQuery(bookingStateQueryOptions(collection, fleetId, bookingId));

  const tripIds = useMemo(
    () => (trips.data ? new Set(trips.data.map((trip) => trip.tripId)) : null),
    [trips.data],
  );
  const customer =
    fromList?.customer ?? customers.data?.find((candidate) => candidate.id === booking?.userId);
  const stateValue = state.data !== undefined ? state.data : fromList?.state;
  const tab = fromList?.tab ?? (booking ? tabOfDetail(booking, tripIds) : null);

  const ctx = useMemo<BookingContext | null>(() => {
    if (!booking || tab === null) return null;
    if (fromList && fromList.customer === customer && fromList.state === stateValue) return fromList;
    return { booking, tab, customer, state: stateValue };
  }, [booking, tab, customer, stateValue, fromList]);

  const customerStatus: CustomerStatus =
    booking?.userId === null || booking?.userId === undefined
      ? 'missing'
      : customer
        ? 'ok'
        : customers.isError
          ? 'error'
          : customers.isSuccess
            ? 'missing'
            : 'loading';
  return {
    ctx,
    isLoading: fromList === undefined && single.isPending,
    error: fromList === undefined ? single.error : null,
    customerStatus,
  };
}
