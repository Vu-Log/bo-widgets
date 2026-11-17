import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListTab } from '../../domain/statuses';
import { renderInWidget } from '../../test/render';
import { apiBooking, fleetApi, stubVulogApi } from '../../test/vulog-api';
import { DEFAULT_SORTS, useTabBookings, type TabBookings } from './use-tab-bookings';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

async function run(tab: ListTab, loadAll = false) {
  let latest: TabBookings | undefined;
  function Probe() {
    latest = useTabBookings('FLEET-1', tab, DEFAULT_SORTS[tab], loadAll);
    return null;
  }
  const view = await renderInWidget(<Probe />);
  unmount = view.unmount;
  return () => latest!;
}

describe('useTabBookings', () => {
  it('reads the pages of the status of a tab with its default sort', async () => {
    const fetch = stubVulogApi(fleetApi({ bookings: { CANCELLED: [apiBooking({ id: 'c-1', status: 'CANCELLED' })] } }));
    const state = await run('cancelled');
    await vi.waitFor(() => expect(state().bookings.map((b) => b.id)).toEqual(['c-1']));
    expect(state().complete).toBe(true);
    expect(state().updatedAt).toBeGreaterThan(0);
    expect(String(fetch.mock.calls[0]?.[0])).toContain('status/CANCELLED?page=0&size=50&sort=cancellationDate%2CDESC');
  });

  it('keeps the Ongoing bookings of the trips in progress, read at once', async () => {
    stubVulogApi(
      fleetApi({
        bookings: {
          CONFIRMED: [
            apiBooking({ id: 'on', status: 'CONFIRMED', journeyId: 'trip-1' }),
            apiBooking({ id: 'done', status: 'CONFIRMED', journeyId: 'trip-2', completed: true }),
          ],
        },
        trips: [{ id: 'v', orderId: 'trip-1' }],
      }),
    );
    const state = await run('ongoing');
    await vi.waitFor(() => expect(state().bookings.map((b) => b.id)).toEqual(['on']));
    expect(state().pagination).toBeUndefined();
  });

  it('fails Completed when the trips in progress fail', async () => {
    stubVulogApi(fleetApi({ bookings: { CONFIRMED: [apiBooking({ status: 'CONFIRMED', completed: true })] } }, ({ path }) =>
      path.endsWith('/book') ? new Response('', { status: 500 }) : undefined,
    ));
    const state = await run('completed');
    await vi.waitFor(() => expect(state().error).not.toBeNull(), { timeout: 5000 });
    expect(state().bookings).toEqual([]);
  });

  it('loads every page with loadAll, with the progress', async () => {
    stubVulogApi(({ path, query }) => {
      if (!path.endsWith('status/PENDING')) return undefined;
      const page = Number(query.get('page'));
      return Response.json([apiBooking({ id: `b-${page}` })], { headers: { totalpages: '3', totalelements: '3' } });
    });
    const state = await run('upcoming', true);
    await vi.waitFor(() => expect(state().bookings.map((b) => b.id)).toEqual(['b-0', 'b-1', 'b-2']));
    expect(state().complete).toBe(true);
    expect(state().progress).toBeNull();
  });

  it('reports a failed first page as an error', async () => {
    stubVulogApi(() => new Response('', { status: 403 }));
    const state = await run('alert');
    await vi.waitFor(() => expect(state().error?.message).toContain('not allowed'));
  });
});
