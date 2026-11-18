import { afterEach, describe, expect, it, vi } from 'vitest';
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
  function Probe() {
    const counts = useTabCounts('FLEET-1');
    return <p>{JSON.stringify(counts)}</p>;
  }
  const countsOf = (view: { container: HTMLElement }) => JSON.parse(view.container.textContent ?? '{}');

  it('counts Alert, Upcoming and Cancelled with the API totals, Ongoing and Completed from CONFIRMED', async () => {
    const fetch = stubVulogApi(
      fleetApi({
        bookings: {
          ALERT: [apiBooking()],
          PENDING: [apiBooking(), apiBooking()],
          CANCELLED: [],
          CONFIRMED: [
            apiBooking({ id: 'b-1', status: 'CONFIRMED', journeyId: 'trip-1' }),
            apiBooking({ id: 'b-2', status: 'CONFIRMED', journeyId: 'trip-2', completed: true }),
            apiBooking({ id: 'b-3', status: 'CONFIRMED', journeyId: 'trip-3', completed: true }),
            // Confirmed, not started: in no tab.
            apiBooking({ id: 'b-4', status: 'CONFIRMED' }),
          ],
        },
        trips: [{ id: 'vehicle-1', orderId: 'trip-1' }],
      }),
    );
    const view = await renderInWidget(<Probe />);
    unmount = view.unmount;
    await vi.waitFor(() =>
      expect(countsOf(view)).toEqual({ alert: 1, upcoming: 2, cancelled: 0, ongoing: 1, completed: 2 }),
    );
    // One read of CONFIRMED, the largest page: the one the Ongoing tab reads too.
    const confirmed = fetch.mock.calls.map(([input]) => String(input)).filter((url) => url.includes('status/CONFIRMED'));
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]).toContain('size=2000');
  });

  it('leaves Completed unknown when the CONFIRMED bookings are more than one read holds', async () => {
    stubVulogApi(
      fleetApi({ trips: [{ id: 'vehicle-1', orderId: 'trip-1' }] }, ({ path }) =>
        path.endsWith('/status/CONFIRMED')
          ? Response.json([apiBooking({ id: 'b-1', status: 'CONFIRMED', journeyId: 'trip-1' })], {
              headers: { totalelements: '2001', totalpages: '2' },
            })
          : undefined,
      ),
    );
    const view = await renderInWidget(<Probe />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(countsOf(view).ongoing).toBe(1));
    expect(countsOf(view).completed).toBeNull();
  });

  it('leaves Completed unknown when a full read gives no total', async () => {
    const full = Array.from({ length: 2000 }, (_, index) =>
      apiBooking({ id: `b-${index}`, status: 'CONFIRMED', journeyId: `trip-${index}`, completed: true }),
    );
    stubVulogApi(
      fleetApi({ trips: [] }, ({ path }) => (path.endsWith('/status/CONFIRMED') ? Response.json(full) : undefined)),
    );
    const view = await renderInWidget(<Probe />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(countsOf(view).ongoing).toBe(0));
    expect(countsOf(view).completed).toBeNull();
  });

  it('leaves a count unknown when its call fails', async () => {
    stubVulogApi(() => new Response('', { status: 500 }));
    const view = await renderInWidget(<Probe />);
    unmount = view.unmount;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(JSON.parse(view.container.textContent ?? '{}').alert).toBeNull();
  });
});
