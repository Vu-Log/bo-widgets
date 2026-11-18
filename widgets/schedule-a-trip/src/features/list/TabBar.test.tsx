import { useQueryClient } from '@tanstack/react-query';
import { useAuthFetch } from '@vulog/bo-widget-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmedBookingsQueryOptions, tripsInProgressQueryOptions } from '../../query/queries';
import { renderInWidget } from '../../test/render';
import { apiBooking, fleetApi, stubVulogApi } from '../../test/vulog-api';
import { TabBar, useTabCounts } from './TabBar';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

describe('TabBar', () => {
  it('shows the five tabs with their counts, Alert in red when it has bookings', async () => {
    const onChange = vi.fn();
    const view = await renderInWidget(
      <TabBar
        tab="upcoming"
        onChange={onChange}
        counts={{ alert: 2, upcoming: 0, ongoing: null, completed: null, cancelled: 1234 }}
      />,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.querySelectorAll('[role="tab"]')).toHaveLength(5));
    const tabs = [...view.container.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Alert2', 'Upcoming0', 'Ongoing', 'Completed', 'Cancelled1,234']);
    expect(tabs[0]?.querySelector('.MuiBadge-colorError')).not.toBeNull();
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[1]?.getAttribute('aria-controls')).toBe('schedule-a-trip-panel-upcoming');
    tabs[4]?.click();
    expect(onChange).toHaveBeenCalledWith('cancelled');
  });
});

describe('useTabCounts', () => {
  function Probe({ prefetch = false }: { prefetch?: boolean }) {
    const counts = useTabCounts('FLEET-1');
    const client = useQueryClient();
    const authFetch = useAuthFetch();
    if (prefetch) {
      void client.prefetchQuery(confirmedBookingsQueryOptions(authFetch, 'FLEET-1'));
      void client.prefetchQuery(tripsInProgressQueryOptions(authFetch, 'FLEET-1'));
    }
    return <p>{JSON.stringify(counts)}</p>;
  }

  it('counts Alert, Upcoming and Cancelled with the API totals, Ongoing once loaded, never Completed', async () => {
    const fetch = stubVulogApi(
      fleetApi({
        bookings: {
          ALERT: [apiBooking()],
          PENDING: [apiBooking(), apiBooking()],
          CANCELLED: [],
          CONFIRMED: [apiBooking({ status: 'CONFIRMED', journeyId: 'trip-1' })],
        },
        trips: [{ id: 'vehicle-1', orderId: 'trip-1' }],
      }),
    );
    const view = await renderInWidget(<Probe />);
    unmount = view.unmount;
    await vi.waitFor(() =>
      expect(JSON.parse(view.container.textContent ?? '{}')).toEqual({
        alert: 1,
        upcoming: 2,
        cancelled: 0,
        ongoing: null,
        completed: null,
      }),
    );
    expect(fetch.mock.calls.some(([input]) => String(input).includes('CONFIRMED'))).toBe(false);
    view.rerender(<Probe prefetch />);
    await vi.waitFor(() => expect(JSON.parse(view.container.textContent ?? '{}').ongoing).toBe(1));
  });

  it('leaves a count unknown when its call fails', async () => {
    stubVulogApi(() => new Response('', { status: 500 }));
    const view = await renderInWidget(<Probe />);
    unmount = view.unmount;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(JSON.parse(view.container.textContent ?? '{}').alert).toBeNull();
  });
});
