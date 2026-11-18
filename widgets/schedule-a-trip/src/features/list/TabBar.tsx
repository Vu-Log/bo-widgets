import { Badge, Tab, Tabs } from '@mui/material';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@vulog/bo-widget-react';
import { useMemo } from 'react';
import { MAX_BOOKING_PAGE_SIZE } from '../../api/schedule-a-trip';
import { LIST_TABS, tabOfBooking, type ListTab } from '../../domain/statuses';
import { useI18n } from '../../i18n';
import {
  bookingCountQueryOptions,
  confirmedBookingsQueryOptions,
  tripsInProgressQueryOptions,
} from '../../query/queries';

/** Tabs counted with a page of one row: their total comes from the API. */
const COUNTED_TABS = ['alert', 'upcoming', 'cancelled'] as const;

/** The id of a tab and of its panel, for the ARIA links. */
export const tabId = (tab: ListTab) => `schedule-a-trip-tab-${tab}`;
export const panelId = (tab: ListTab) => `schedule-a-trip-panel-${tab}`;

/**
 * The number of bookings of each tab, when known. The API gives a total per AIMA status only (the
 * `totalelements` header): read with a page of one row for Alert, Upcoming and Cancelled. Ongoing
 * and Completed share `CONFIRMED`: they are counted from the one read of the `CONFIRMED` bookings
 * and the trips in progress (shared with the Ongoing tab), Completed only when that read holds
 * every `CONFIRMED` booking.
 *
 * @param fleetId - The fleet.
 * @returns The count by tab, `null` when unknown.
 */
export function useTabCounts(fleetId: string): Readonly<Record<ListTab, number | null>> {
  const authFetch = useAuthFetch();
  const counts = useQueries({
    queries: COUNTED_TABS.map((tab) => bookingCountQueryOptions(authFetch, fleetId, tab)),
  });
  const confirmed = useQuery(confirmedBookingsQueryOptions(authFetch, fleetId));
  const trips = useQuery(tripsInProgressQueryOptions(authFetch, fleetId));
  const split = useMemo(() => {
    if (!confirmed.data || !trips.data) return { ongoing: null, completed: null };
    const ids = new Set(trips.data.map((trip) => trip.tripId));
    const tabs = confirmed.data.items.map((booking) => tabOfBooking(booking, ids));
    const total = confirmed.data.totalElements;
    // Without a total, a full page may hide more bookings.
    const whole =
      total === null ? confirmed.data.items.length < MAX_BOOKING_PAGE_SIZE : total <= confirmed.data.items.length;
    return {
      ongoing: tabs.filter((tab) => tab === 'ongoing').length,
      completed: whole ? tabs.filter((tab) => tab === 'completed').length : null,
    };
  }, [confirmed.data, trips.data]);
  return {
    alert: counts[0]?.data ?? null,
    upcoming: counts[1]?.data ?? null,
    cancelled: counts[2]?.data ?? null,
    ...split,
  };
}

/**
 * The five tabs of the list, each with its count; Alert in red when it has bookings.
 *
 * @param props - The tab shown, its setter and the counts.
 * @returns The tabs.
 */
export function TabBar({
  tab,
  onChange,
  counts,
}: {
  readonly tab: ListTab;
  readonly onChange: (tab: ListTab) => void;
  readonly counts: Readonly<Record<ListTab, number | null>>;
}) {
  const { t, formatNumber } = useI18n();
  return (
    <Tabs
      value={tab}
      onChange={(_, value: ListTab) => onChange(value)}
      aria-label={t('tabs.label')}
      variant="scrollable"
      sx={{ flex: 'none', borderBottom: 1, borderColor: 'divider', px: 2 }}
    >
      {LIST_TABS.map((value) => {
        const count = counts[value];
        return (
          <Tab
            key={value}
            value={value}
            id={tabId(value)}
            aria-controls={panelId(value)}
            label={
              count === null ? (
                t(`tabs.${value}`)
              ) : (
                <Badge
                  badgeContent={formatNumber(count)}
                  color={value === 'alert' && count > 0 ? 'error' : 'default'}
                  max={Number.MAX_SAFE_INTEGER}
                  showZero
                  sx={{
                    pr: 2.5,
                    '& .MuiBadge-badge': {
                      position: 'static',
                      transform: 'none',
                      ml: 1,
                      bgcolor: value === 'alert' && count > 0 ? undefined : 'action.selected',
                    },
                  }}
                >
                  {t(`tabs.${value}`)}
                </Badge>
              )
            }
          />
        );
      })}
    </Tabs>
  );
}
