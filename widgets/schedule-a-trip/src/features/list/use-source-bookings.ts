import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useAuthFetch } from '@vulog/bo-widget-react';
import { useCallback } from 'react';
import { ApiRequestError } from '../../api/http';
import type { ScheduledBooking } from '../../api/schedule-a-trip';
import type { ListTab } from '../../domain/statuses';
import { bookingQueryOptions } from '../../query/queries';
import { tabOfDetail } from '../detail/use-detail-context';

const NONE: readonly ScheduledBooking[] = [];

/** The bookings a filter found, and how many could not be read. */
export interface SourceBookings {
  readonly bookings: readonly ScheduledBooking[];
  /** Ids that could not be read, but not found (a 404 means the booking is gone). */
  readonly failed: number;
}

/**
 * The bookings a filter found by id (`FilterSource`), read one by one, and kept when they belong to
 * the tab (by their status; a confirmed one by its completion). A booking that cannot be read is
 * left out and counted, so that the section says the list is incomplete.
 *
 * @param fleetId - The fleet.
 * @param tab - The tab shown.
 * @param bookingIds - The ids found by the active filters.
 * @returns The bookings read so far, in the order of the ids, and the count of failures.
 */
export function useSourceBookings(
  fleetId: string,
  tab: ListTab,
  bookingIds: readonly string[],
): SourceBookings {
  const authFetch = useAuthFetch();
  const combine = useCallback(
    (results: UseQueryResult<ScheduledBooking>[]) => {
      const found = results.flatMap((result) =>
        result.data && tabOfDetail(result.data, null) === tab ? [result.data] : [],
      );
      const failed = results.filter(
        (result) =>
          result.isError &&
          !(result.error instanceof ApiRequestError && result.error.error.kind === 'not-found'),
      ).length;
      return { bookings: found.length === 0 ? NONE : found, failed };
    },
    [tab],
  );
  return useQueries({
    queries: [...new Set(bookingIds)].map((bookingId) => bookingQueryOptions(authFetch, fleetId, bookingId)),
    combine,
  });
}
