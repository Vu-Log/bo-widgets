import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../api/http';
import { createI18n } from '../../i18n';
import { fakeBo, jsonResponse } from '../../test/fake-bo';
import { booking, context, renderInSection, stateDoc } from '../../test/section';
import { stubVulogApi } from '../../test/vulog-api';
import { CustomerCard, TripCard, VehicleCard } from './cards';
import { queryErrorText } from './common';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  unmount = undefined;
  vi.restoreAllMocks();
});

const render = async (...args: Parameters<typeof renderInSection>) => {
  const view = await renderInSection(...args);
  unmount = view.unmount;
  return view;
};

const routedBo = () => {
  const bo = fakeBo();
  const navigate = vi.fn(async ({ path }: { path: string }) => ({ path }));
  Object.assign(bo.api, { navigate });
  return { api: bo.api, navigate };
};

describe('TripCard', () => {
  it('shows the dates in the zone of the fleet, the radius, the map and the alert reason', async () => {
    const view = await render(
      <TripCard
        ctx={context({
          booking: booking({ failureReason: 'No vehicle in the radius', notes: 'Child seat' }),
        })}
      />,
    );
    await vi.waitFor(() => expect(view.container.textContent).toContain('Trip'));
    const text = view.container.textContent ?? '';
    expect(text).toContain('10/03/2026, 10:00');
    expect(text).toContain('500 m');
    expect(text).toContain('No vehicle in the radius');
    expect(text).toContain('Child seat');
    expect(text).toContain('48.85660, 2.35220');
    expect(view.container.querySelector('svg[role="img"]')).not.toBeNull();
  });

  it('shows the address found by the geocoding', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ features: [{ place_name: '1 Example Street', center: [2.35, 48.85] }] }),
    );
    const view = await render(<TripCard ctx={context()} />, { value: { mapboxToken: 'pk.test' } });
    await vi.waitFor(() => expect(view.container.textContent).toContain('1 Example Street'));
  });

  it('keeps the coordinates when the geocoding fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    const view = await render(<TripCard ctx={context()} />, { value: { mapboxToken: 'pk.test' } });
    await vi.waitFor(() =>
      expect(view.container.querySelector('[title="The address could not be found."]')?.textContent).toBe(
        '48.85660, 2.35220',
      ),
    );
  });

  it('says how long before the start a booking was cancelled, and links its trip', async () => {
    const { api, navigate } = routedBo();
    const view = await render(
      <TripCard
        ctx={context({
          tab: 'completed',
          booking: booking({ cancellationDate: '2026-03-10T07:00:00Z', journeyId: 'trip/1', latitude: null }),
        })}
      />,
      { api },
    );
    await vi.waitFor(() => expect(view.container.textContent).toContain('(3 h before the start)'));
    expect(view.container.querySelector('svg[role="img"]')).toBeNull();
    [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Open the trip')?.click();
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ path: '/app/trips/completed/trip%2F1' }),
    );
  });

  it('logs a navigation the back office refuses', async () => {
    const bo = fakeBo({ navigate: vi.fn(async () => Promise.reject(Object.assign(new Error('no'), { code: 'forbidden' }))) });
    const view = await render(
      <TripCard ctx={context({ tab: 'ongoing', booking: booking({ journeyId: 'trip-1' }) })} />,
      { api: bo.api },
    );
    await vi.waitFor(() => expect(view.container.textContent).toContain('Open the trip'));
    [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Open the trip')?.click();
    await vi.waitFor(() => expect(bo.api.log.warn).toHaveBeenCalled());
  });
});

describe('VehicleCard', () => {
  it('shows the model, the allocated vehicle and the pre-allocated one', async () => {
    stubVulogApi(({ path }) =>
      path.endsWith('/vehicles/models')
        ? jsonResponse([{ id: 7, name: 'City car' }])
        : path === 'user/vehicle/fleets/FLEET-1/vehicles'
          ? jsonResponse([{ id: 'vehicle-1', plate: 'AB-123-CD' }])
          : undefined,
    );
    const { api, navigate } = routedBo();
    const view = await render(
      <VehicleCard
        ctx={context({
          booking: booking({ vehicleId: 'vehicle-1' }),
          state: stateDoc({ preallocatedVehicleId: 'vehicle-2', preallocatedPlate: 'ZZ-999-ZZ' }),
        })}
      />,
      { api },
    );
    await vi.waitFor(() => expect(view.container.textContent).toContain('AB-123-CD'));
    expect(view.container.textContent).toContain('City car');
    expect(view.container.textContent).toContain('ZZ-999-ZZ');
    [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'ZZ-999-ZZ')?.click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith({ path: '/app/new-vehicles/vehicle-2' }));
  });

  it('says none without a vehicle', async () => {
    stubVulogApi(() => jsonResponse([]));
    const view = await render(<VehicleCard ctx={context({ booking: booking({ modelId: null }) })} />);
    await vi.waitFor(() => expect(view.container.textContent).toContain('Allocated vehicle–'));
    expect(view.container.textContent).not.toContain('Pre-allocated vehicle');
  });
});

describe('CustomerCard', () => {
  it('shows the customer with a link to their profile', async () => {
    const { api, navigate } = routedBo();
    const view = await render(<CustomerCard ctx={context()} />, { api });
    await vi.waitFor(() => expect(view.container.textContent).toContain('jane.doe'));
    expect(view.container.textContent).toContain('Personal');
    view.container.querySelector<HTMLButtonElement>('button')?.click();
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ path: '/app/users/user-1/profile/profile-1' }),
    );
  });

  it('shows a skeleton while loading and an error when the customer failed', async () => {
    const loading = await render(<CustomerCard ctx={context({ customer: undefined })} />, {
      value: { customerStatus: () => 'loading' },
    });
    await vi.waitFor(() => expect(loading.container.querySelector('[data-skeleton]')).not.toBeNull());
    loading.unmount();
    const failed = await render(<CustomerCard ctx={context({ customer: undefined })} />, {
      value: { customerStatus: () => 'error' },
    });
    await vi.waitFor(() => expect(failed.container.textContent).toContain('could not be loaded'));
  });
});

describe('queryErrorText', () => {
  const { t } = createI18n('en_GB');

  it('says a 403 is not allowed', () => {
    expect(queryErrorText(new ApiRequestError({ kind: 'not-allowed', status: 403 }), t)).toContain(
      'not allowed',
    );
  });

  it('gives a generic message for another error', () => {
    expect(queryErrorText(new Error('raw details'), t)).toBe('Something went wrong. Try again.');
  });
});
