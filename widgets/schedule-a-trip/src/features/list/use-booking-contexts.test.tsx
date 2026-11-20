import { connect } from '@vulog/bo-widget-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledBooking } from '../../api/schedule-a-trip';
import { bookingsCollection, createBookingState } from '../../storage/booking-state';
import { fakeBo, hostError } from '../../test/fake-bo';
import { renderInWidget } from '../../test/render';
import { booking } from '../../test/section';
import { fleetApi, stubVulogApi } from '../../test/vulog-api';
import { chunk, useBookingContexts, type BookingContexts } from './use-booking-contexts';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

const bookings: ScheduledBooking[] = [
  booking({ id: 'b-1', userId: 'user-1' }),
  booking({ id: 'b-2', userId: 'user-2' }),
  booking({ id: 'b-3', userId: null }),
];

async function run(api: object, rows: readonly ScheduledBooking[] = bookings) {
  const seen: BookingContexts[] = [];
  function Probe({ list }: { list: readonly ScheduledBooking[] }) {
    seen.push(useBookingContexts({ fleetId: 'FLEET-1', tab: 'upcoming', bookings: list }));
    return null;
  }
  const view = await renderInWidget(<Probe list={rows} />, api);
  unmount = view.unmount;
  return {
    latest: () => seen.at(-1)!,
    seen,
    rerender: (list: readonly ScheduledBooking[]) => view.rerender(<Probe list={list} />),
  };
}

const usersListBodies = (fetch: ReturnType<typeof stubVulogApi>) =>
  fetch.mock.calls
    .filter(([input]) => String(input).includes('users/list'))
    .map(([, init]) => JSON.parse(String(init?.body)) as string[]);

/** `count` bookings from `b-{from}`, each with its own customer `user-{n}`. */
const manyBookings = (from: number, count: number, userOf = (n: number) => `user-${n}`) =>
  Array.from({ length: count }, (_, index) =>
    booking({ id: `b-${from + index}`, userId: userOf(from + index) }),
  );

describe('chunk', () => {
  it('splits in chunks of a size, the last one shorter', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe('useBookingContexts', () => {
  it('loads the customers of the page, the states of the fleet, and keeps the contexts', async () => {
    const fetch = stubVulogApi(fleetApi({}));
    const bo = fakeBo();
    const seeding = await connect({ vulogBo: bo.api });
    await createBookingState(bookingsCollection(seeding.storage), 'b-2', { fleetId: 'FLEET-1' });
    seeding.disconnect();

    const { latest, rerender } = await run(bo.api);

    await vi.waitFor(() => expect(latest().contexts[1]?.customer?.id).toBe('user-2'));
    await vi.waitFor(() => expect(latest().contexts[1]?.state?.id).toBe('b-2'));
    expect(latest().contexts[0]?.customer?.id).toBe('user-1');
    expect(latest().contexts[0]?.state).toBeNull();
    expect(latest().customerStatus('user-1')).toBe('ok');
    expect(latest().customerStatus('user-9')).toBe('loading');
    expect(latest().customerStatus(null)).toBe('missing');
    const first = latest().contexts[0];
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      (first as { tab: string }).tab = 'alert';
    }).toThrow(TypeError);

    rerender([...bookings]);
    expect(latest().contexts[0]).toBe(first);
    // One call for the page, whatever the rows shown.
    expect(usersListBodies(fetch)).toEqual([['user-1', 'user-2']]);
  });

  it('asks for the customers once per page of 50 bookings, each customer once', async () => {
    const fetch = stubVulogApi(fleetApi({}));
    // The second page repeats the customer of b-1, the third has the customers of the first page only.
    const first = manyBookings(1, 50);
    const second = [booking({ id: 'b-51', userId: 'user-1' }), ...manyBookings(52, 49)];
    const { latest, rerender } = await run(fakeBo().api, first);
    await vi.waitFor(() => expect(latest().customerStatus('user-50')).toBe('ok'));
    expect(usersListBodies(fetch)).toEqual([first.map((row) => row.userId)]);

    rerender([...first, ...second]);
    await vi.waitFor(() => expect(latest().customerStatus('user-100')).toBe('ok'));
    const third = manyBookings(101, 10, (n) => `user-${n - 100}`);
    rerender([...first, ...second, ...third]);

    await vi.waitFor(() => expect(latest().contexts[109]?.customer?.id).toBe('user-10'));
    const bodies = usersListBodies(fetch);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(manyBookings(52, 49).map((row) => row.userId));
    expect(bodies.every((ids) => ids.length <= 50)).toBe(true);
  });

  it('marks the customers of a failed batch, and asks again on retry', async () => {
    let fail = true;
    stubVulogApi(fleetApi({}, ({ path }) => (fail && path.endsWith('users/list') ? new Response('', { status: 403 }) : undefined)));
    const { latest } = await run(fakeBo().api);
    await vi.waitFor(() => expect(latest().customerStatus('user-1')).toBe('error'));
    fail = false;
    latest().retryCustomers();
    await vi.waitFor(() => expect(latest().customerStatus('user-1')).toBe('ok'));
  });

  it('marks a customer the API does not know as missing', async () => {
    stubVulogApi(fleetApi({}, ({ path }) => (path.endsWith('users/list') ? Response.json([]) : undefined)));
    const { latest } = await run(fakeBo().api);
    await vi.waitFor(() => expect(latest().customerStatus('user-1')).toBe('missing'));
  });

  it('reports a failure of the storage and keeps the states undefined', async () => {
    stubVulogApi(fleetApi({}));
    const bo = fakeBo();
    bo.storage.api.query.mockRejectedValue(hostError('rate-limited', 429));
    const { latest } = await run(bo.api);
    await vi.waitFor(() => expect(latest().statesError).not.toBeNull());
    expect(latest().contexts[0]?.state).toBeUndefined();
    bo.storage.api.query.mockResolvedValue({ items: [], nextCursor: null });
    latest().retryStates();
    await vi.waitFor(() => expect(latest().contexts[0]?.state).toBeNull());
  });
});

describe('useBookingContexts, over time', () => {
  it('keeps the stored state of a row once its own query was collected', async () => {
    stubVulogApi(fleetApi({}));
    const bo = fakeBo();
    const seeding = await connect({ vulogBo: bo.api });
    await createBookingState(bookingsCollection(seeding.storage), 'b-2', { fleetId: 'FLEET-1' });
    seeding.disconnect();
    let latest: BookingContexts | undefined;
    function Probe() {
      latest = useBookingContexts({ fleetId: 'FLEET-1', tab: 'upcoming', bookings });
      return null;
    }
    const view = await renderInWidget(<Probe />, bo.api);
    unmount = view.unmount;
    await vi.waitFor(() => expect(latest?.contexts[1]?.state?.id).toBe('b-2'));

    view.queryClient.removeQueries({ queryKey: ['booking-states', 'FLEET-1', 'b-2'], exact: true });
    view.rerender(<Probe />);

    await vi.waitFor(() => expect(latest?.contexts[1]?.state?.id).toBe('b-2'));
  });

  it('logs the documents that break the contract', async () => {
    stubVulogApi(fleetApi({}));
    const bo = fakeBo();
    await bo.storage.api.set('bookings', 'b-1', { schemaVersion: 99, fleetId: 'FLEET-1', allocationProcessed: false });
    let latest: BookingContexts | undefined;
    function Probe() {
      latest = useBookingContexts({ fleetId: 'FLEET-1', tab: 'upcoming', bookings });
      return null;
    }
    const view = await renderInWidget(<Probe />, bo.api);
    unmount = view.unmount;
    await vi.waitFor(() => expect(bo.api.log.warn).toHaveBeenCalled());
    expect(latest?.contexts[0]?.state).toBeNull();
  });
});
