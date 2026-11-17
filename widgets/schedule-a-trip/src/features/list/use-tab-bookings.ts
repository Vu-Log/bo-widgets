import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@vulog/bo-widget-react';
import { useEffect, useMemo } from 'react';
import type { ScheduledBooking } from '../../api/schedule-a-trip';
import { tabOfBooking, type ListTab } from '../../domain/statuses';
import type { BookingListSort } from '../../query/keys';
import {
  bookingPagesQueryOptions,
  confirmedBookingsQueryOptions,
  tripsInProgressQueryOptions,
} from '../../query/queries';
import type { ListGridPagination } from '../../ui/ListGrid';

/** The default sort of a tab: the next departures first, the latest ones in the past tabs. */
export const DEFAULT_SORTS: Readonly<Record<ListTab, BookingListSort>> = {
  alert: { field: 'startDate', direction: 'ASC' },
  upcoming: { field: 'startDate', direction: 'ASC' },
  ongoing: { field: 'startDate', direction: 'DESC' },
  completed: { field: 'startDate', direction: 'DESC' },
  cancelled: { field: 'cancellationDate', direction: 'DESC' },
};

/** The bookings of a tab, as the list shows them. */
export interface TabBookings {
  readonly bookings: readonly ScheduledBooking[];
  /** The first rows are loading. */
  readonly isLoading: boolean;
  /** The first rows (or the trips in progress) could not be loaded. */
  readonly error: Error | null;
  /** Paging of the grid; `undefined` for a tab loaded at once (Ongoing). */
  readonly pagination: ListGridPagination | undefined;
  /** Every page is loaded. */
  readonly complete: boolean;
  /** Pages loaded and their total, while every page is being loaded. */
  readonly progress: { readonly loaded: number; readonly total: number | null } | null;
  /** When the first page was received, in ms, 0 before. */
  readonly updatedAt: number;
  readonly refetch: () => void;
}

/**
 * The bookings of a tab, page by page. Ongoing reads the `CONFIRMED` bookings at once and keeps
 * those whose trip is in progress; Completed reads them page by page and leaves those out. With
 * `loadAll`, every page is loaded in the background (for a filter AIMA cannot apply), with the
 * progress.
 *
 * @param fleetId - The fleet.
 * @param tab - The tab.
 * @param sort - The sort of the API.
 * @param loadAll - Load every page.
 * @returns The rows and the state of their loading.
 */
export function useTabBookings(
  fleetId: string,
  tab: ListTab,
  sort: BookingListSort,
  loadAll: boolean,
): TabBookings {
  const authFetch = useAuthFetch();
  const split = tab === 'ongoing' || tab === 'completed';
  const trips = useQuery({ ...tripsInProgressQueryOptions(authFetch, fleetId), enabled: split });
  const confirmed = useQuery({
    ...confirmedBookingsQueryOptions(authFetch, fleetId),
    enabled: tab === 'ongoing',
  });
  const pages = useInfiniteQuery({
    ...bookingPagesQueryOptions(authFetch, { fleetId, tab, sort }),
    enabled: tab !== 'ongoing',
  });

  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = pages;
  const wantsMore = loadAll && tab !== 'ongoing' && hasNextPage && !isFetchingNextPage;
  const pageCount = pages.data?.pages.length ?? 0;
  // Keyed on the pages loaded too: the render where a page is loading may be batched away.
  useEffect(() => {
    if (wantsMore && !isFetchNextPageError) void fetchNextPage();
  }, [wantsMore, isFetchNextPageError, fetchNextPage, pageCount]);

  const tripIds = useMemo(
    () => new Set((trips.data ?? []).map((trip) => trip.tripId)),
    [trips.data],
  );
  const bookings = useMemo(() => {
    const source =
      tab === 'ongoing'
        ? (confirmed.data?.items ?? [])
        : (pages.data?.pages.flatMap((page) => page.items) ?? []);
    if (!split) return source;
    if (!trips.data) return [];
    return source.filter((booking) => tabOfBooking(booking, tripIds) === tab);
  }, [tab, split, confirmed.data, pages.data, trips.data, tripIds]);

  if (tab === 'ongoing') {
    return {
      bookings,
      isLoading: confirmed.isPending || trips.isPending,
      error: confirmed.error ?? trips.error,
      pagination: undefined,
      complete: true,
      progress: null,
      updatedAt: confirmed.dataUpdatedAt,
      refetch: () => {
        void confirmed.refetch();
        void trips.refetch();
      },
    };
  }

  const totalPages = pages.data?.pages[0]?.totalPages ?? null;
  return {
    bookings,
    isLoading: pages.isPending || (split && trips.isPending),
    // A failed next page is shown by the grid, under the rows already there.
    error: (pages.isError && !pages.isFetchNextPageError ? pages.error : null) ?? (split ? trips.error : null),
    pagination: {
      hasNextPage,
      isFetchingNextPage,
      isFetchNextPageError,
      fetchNextPage: () => void fetchNextPage(),
    },
    complete: pages.isSuccess && !hasNextPage,
    progress:
      loadAll && pages.isSuccess && hasNextPage ? { loaded: pageCount, total: totalPages } : null,
    updatedAt: pages.dataUpdatedAt,
    refetch: () => {
      void pages.refetch();
      if (split) void trips.refetch();
    },
  };
}
