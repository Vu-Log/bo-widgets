import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useAuthFetch } from '@vulog/bo-widget-react';
import { useCallback } from 'react';
import type { ScheduledBooking } from '../../api/schedule-a-trip';
import type { ListTab } from '../../domain/statuses';
import { bookingQueryOptions } from '../../query/queries';
import { tabOfDetail } from '../detail/use-detail-context';

const NONE: readonly ScheduledBooking[] = [];

/**
 * The bookings a filter found by id (`FilterSource`), read one by one, and kept when they belong to
 * the tab (by their status; a confirmed one by its completion). A booking that cannot be read is
 * left out.
 *
 * @param fleetId - The fleet.
 * @param tab - The tab shown.
 * @param bookingIds - The ids found by the active filters.
 * @returns The bookings read so far, in the order of the ids.
 */
export function useSourceBookings(
  fleetId: string,
  tab: ListTab,
  bookingIds: readonly string[],
): readonly ScheduledBooking[] {
  const authFetch = useAuthFetch();
  const combine = useCallback(
    (results: UseQueryResult<ScheduledBooking>[]) => {
      const found = results.flatMap((result) =>
        result.data && tabOfDetail(result.data, null) === tab ? [result.data] : [],
      );
      return found.length === 0 ? NONE : found;
    },
    [tab],
  );
  return useQueries({
    queries: [...new Set(bookingIds)].map((bookingId) => bookingQueryOptions(authFetch, fleetId, bookingId)),
    combine,
  });
}
