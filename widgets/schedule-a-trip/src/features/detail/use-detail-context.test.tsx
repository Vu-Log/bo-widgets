import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBo } from '../../test/fake-bo';
import { renderInWidget } from '../../test/render';
import { booking, context } from '../../test/section';
import { apiBooking, fleetApi, stubVulogApi } from '../../test/vulog-api';
import type { BookingContext } from '../extensions';
import { tabOfDetail, useDetailContext, type DetailContext } from './use-detail-context';

describe('tabOfDetail', () => {
  it('splits a confirmed booking with the trips, else with its completion', () => {
    const confirmed = booking({ status: 'CONFIRMED', journeyId: 'trip-1' });
    expect(tabOfDetail(confirmed, new Set(['trip-1']))).toBe('ongoing');
    expect(tabOfDetail(confirmed, null)).toBe('ongoing');
    expect(tabOfDetail(booking({ status: 'CONFIRMED', completed: true }), null)).toBe('completed');
    expect(tabOfDetail(booking({ status: 'CONFIRMED', journeyId: 'trip-1' }), new Set())).toBe('ongoing');
  });

  it('reads the other statuses', () => {
    expect(tabOfDetail(booking({ status: 'CANCELLED' }), null)).toBe('cancelled');
    expect(tabOfDetail(booking({ status: 'ALERT' }), null)).toBe('alert');
    expect(tabOfDetail(booking({ status: 'PENDING' }), null)).toBe('upcoming');
  });
});

describe('useDetailContext', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => {
    unmount?.();
    vi.restoreAllMocks();
  });

  async function run(bookingId: string, fromList?: BookingContext) {
    let latest: DetailContext | undefined;
    function Probe() {
      latest = useDetailContext('FLEET-1', bookingId, fromList);
      return null;
    }
    const view = await renderInWidget(<Probe />, fakeBo().api);
    unmount = view.unmount;
    return () => latest!;
  }

  it('reads a booking of a deep link, its customer and its state', async () => {
    stubVulogApi(fleetApi({ bookings: { ALERT: [apiBooking({ id: 'deep-1', status: 'ALERT' })] } }));
    const state = await run('deep-1');
    await vi.waitFor(() => expect(state().ctx?.customer?.id).toBe('user-1'));
    expect(state().ctx).toMatchObject({ tab: 'alert', state: null });
    expect(state().customerStatus).toBe('ok');
  });

  it('gives the row of the list as it is when it has everything', async () => {
    const fetch = stubVulogApi(fleetApi({}));
    const row = context();
    const state = await run('booking-1', row);
    await vi.waitFor(() => expect(state().ctx).toBe(row));
    expect(fetch.mock.calls.some(([input]) => String(input).includes('bookingrequests'))).toBe(false);
  });

  it('completes a row that has no customer yet', async () => {
    stubVulogApi(fleetApi({}));
    const state = await run('booking-1', context({ customer: undefined }));
    await vi.waitFor(() => expect(state().ctx?.customer?.lastName).toBe('Doe'));
  });

  it('reports a booking that cannot be read', async () => {
    stubVulogApi(fleetApi({}));
    const state = await run('unknown-1');
    await vi.waitFor(() => expect(state().error).not.toBeNull());
    expect(state().ctx).toBeNull();
  });

  it('reports a customer that cannot be read', async () => {
    stubVulogApi(fleetApi({}, ({ path }) => (path.endsWith('users/list') ? new Response('', { status: 500 }) : undefined)));
    const state = await run('booking-1', context({ customer: undefined }));
    await vi.waitFor(() => expect(state().customerStatus).toBe('error'), { timeout: 8000 });
  }, 10_000);
});
