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

async function run(api: object, visible: string[], allCustomers = false) {
  const seen: BookingContexts[] = [];
  function Probe({ ids }: { ids: string[] }) {
    seen.push(
      useBookingContexts({ fleetId: 'FLEET-1', tab: 'upcoming', bookings, visibleIds: new Set(ids), allCustomers }),
    );
    return null;
  }
  const view = await renderInWidget(<Probe ids={visible} />, api);
  unmount = view.unmount;
  return { latest: () => seen.at(-1)!, seen, rerender: (ids: string[]) => view.rerender(<Probe ids={ids} />) };
}

describe('chunk', () => {
  it('splits in chunks of a size, the last one shorter', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe('useBookingContexts', () => {
  it('loads the customers of the visible rows, the states of the fleet, and keeps the contexts', async () => {
    const fetch = stubVulogApi(fleetApi({}));
    const bo = fakeBo();
    const seeding = await connect({ vulogBo: bo.api });
    await createBookingState(bookingsCollection(seeding.storage), 'b-2', { fleetId: 'FLEET-1' });
    seeding.disconnect();

    const { latest, rerender } = await run(bo.api, ['b-1']);

    await vi.waitFor(() => expect(latest().contexts[0]?.customer?.id).toBe('user-1'));
    await vi.waitFor(() => expect(latest().contexts[1]?.state?.id).toBe('b-2'));
    expect(latest().contexts[0]?.state).toBeNull();
    expect(latest().contexts[1]?.customer).toBeUndefined();
    expect(latest().customerStatus('user-1')).toBe('ok');
    expect(latest().customerStatus('user-2')).toBe('loading');
    expect(latest().customerStatus(null)).toBe('missing');
    const first = latest().contexts[0];

    rerender(['b-1', 'b-2']);
    await vi.waitFor(() => expect(latest().contexts[1]?.customer?.id).toBe('user-2'));
    expect(latest().contexts[0]).toBe(first);
    const bodies = fetch.mock.calls.filter(([input]) => String(input).includes('users/list')).map(([, init]) => init?.body);
    expect(bodies).toEqual(['["user-1"]', '["user-2"]']);
  });

  it('loads every customer with allCustomers', async () => {
    const fetch = stubVulogApi(fleetApi({}));
    const { latest } = await run(fakeBo().api, [], true);
    await vi.waitFor(() => expect(latest().contexts[1]?.customer?.id).toBe('user-2'));
    expect(fetch.mock.calls.find(([input]) => String(input).includes('users/list'))?.[1]?.body).toBe('["user-1","user-2"]');
  });

  it('marks the customers of a failed batch, and asks again on retry', async () => {
    let fail = true;
    stubVulogApi(fleetApi({}, ({ path }) => (fail && path.endsWith('users/list') ? new Response('', { status: 403 }) : undefined)));
    const { latest } = await run(fakeBo().api, ['b-1']);
    await vi.waitFor(() => expect(latest().customerStatus('user-1')).toBe('error'));
    fail = false;
    latest().retryCustomers();
    await vi.waitFor(() => expect(latest().customerStatus('user-1')).toBe('ok'));
  });

  it('marks a customer the API does not know as missing', async () => {
    stubVulogApi(fleetApi({}, ({ path }) => (path.endsWith('users/list') ? Response.json([]) : undefined)));
    const { latest } = await run(fakeBo().api, ['b-1']);
    await vi.waitFor(() => expect(latest().customerStatus('user-1')).toBe('missing'));
  });

  it('reports a failure of the storage and keeps the states undefined', async () => {
    stubVulogApi(fleetApi({}));
    const bo = fakeBo();
    bo.storage.api.query.mockRejectedValue(hostError('rate-limited', 429));
    const { latest } = await run(bo.api, []);
    await vi.waitFor(() => expect(latest().statesError).not.toBeNull());
    expect(latest().contexts[0]?.state).toBeUndefined();
    bo.storage.api.query.mockResolvedValue({ items: [], nextCursor: null });
    latest().retryStates();
    await vi.waitFor(() => expect(latest().contexts[0]?.state).toBeNull());
  });
});
