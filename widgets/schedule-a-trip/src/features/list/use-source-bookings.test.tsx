import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledBooking } from '../../api/schedule-a-trip';
import { renderInWidget } from '../../test/render';
import { apiBooking, fleetApi, stubVulogApi } from '../../test/vulog-api';
import { useSourceBookings } from './use-source-bookings';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

async function run(ids: string[]) {
  let latest: readonly ScheduledBooking[] = [];
  function Probe() {
    latest = useSourceBookings('FLEET-1', 'cancelled', ids);
    return null;
  }
  const view = await renderInWidget(<Probe />);
  unmount = view.unmount;
  return () => latest;
}

describe('useSourceBookings', () => {
  it('reads the bookings by id and keeps those of the tab', async () => {
    stubVulogApi(
      fleetApi({
        bookings: {
          CANCELLED: [apiBooking({ id: 'c-1', status: 'CANCELLED' })],
          PENDING: [apiBooking({ id: 'p-1' })],
        },
      }),
    );
    const latest = await run(['c-1', 'p-1', 'c-1']);
    await vi.waitFor(() => expect(latest().map((booking) => booking.id)).toEqual(['c-1']));
  });

  it('leaves out a booking that cannot be read, and gives none without id', async () => {
    stubVulogApi(fleetApi({}));
    const latest = await run(['missing']);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(latest()).toEqual([]);
    unmount?.();
    expect((await run([]))()).toEqual([]);
  });
});
