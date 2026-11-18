import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBo, jsonResponse } from '../../test/fake-bo';
import { booking, context, renderInSection, stateDoc } from '../../test/section';
import { stubVulogApi } from '../../test/vulog-api';
import { CustomerCell, DateCell, ModelCell, Plate, VehicleCell } from './cells';

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

const api = () =>
  stubVulogApi(({ path }) => {
    if (path.endsWith('/vehicles/models')) return jsonResponse([{ id: 7, name: 'City car' }]);
    if (path === 'user/vehicle/fleets/FLEET-1/vehicles') {
      return jsonResponse([{ id: 'vehicle-1', plate: 'AB-123-CD' }]);
    }
    return undefined;
  });

describe('DateCell', () => {
  it('shows how far the date is, the exact date in the zone of the fleet, and the zone', async () => {
    const view = await render(<DateCell value="2026-03-10T10:00:00Z" empty="–" />, {
      value: { timeZone: 'Asia/Tokyo' },
    });
    await vi.waitFor(() => expect(view.container.textContent).toContain('in about 2 hours'));
    expect(view.container.textContent).toContain('10/03/2026, 19:00');
  });

  it('shows the empty text without a date', async () => {
    const view = await render(<DateCell value={null} empty="No return date" />);
    await vi.waitFor(() => expect(view.container.textContent).toBe('No return date'));
  });
});

describe('CustomerCell', () => {
  it('shows the initials, the name and a B2B badge for a business profile', async () => {
    const ctx = context({ booking: booking({ profileId: 'profile-2' }) });
    const view = await render(
      <CustomerCell
        ctx={{
          ...ctx,
          customer: {
            ...ctx.customer!,
            profiles: [{ id: 'profile-2', type: 'Business', entityId: 'entity-1' }],
          },
        }}
      />,
    );
    await vi.waitFor(() => expect(view.container.textContent).toBe('JDJane DoeB2B'));
  });

  it('shows a skeleton while loading, a dash for an unknown customer', async () => {
    const loading = await render(<CustomerCell ctx={context({ customer: undefined })} />, {
      value: { customerStatus: () => 'loading' },
    });
    await vi.waitFor(() => expect(loading.container.querySelector('[data-skeleton]')).not.toBeNull());
    loading.unmount();
    const missing = await render(<CustomerCell ctx={context({ customer: undefined })} />, {
      value: { customerStatus: () => 'missing' },
    });
    await vi.waitFor(() => expect(missing.container.textContent).toBe('–'));
  });

  it('offers to load the customers again after a failure', async () => {
    const retryCustomers = vi.fn();
    const view = await render(<CustomerCell ctx={context({ customer: undefined })} />, {
      value: { customerStatus: () => 'error', retryCustomers },
    });
    await vi.waitFor(() => expect(view.container.querySelector('button')).not.toBeNull());
    view.container.querySelector('button')?.click();
    expect(retryCustomers).toHaveBeenCalled();
  });
});

describe('ModelCell', () => {
  it('names the model from the models of the fleet', async () => {
    api();
    const view = await render(<ModelCell modelId={7} />);
    await vi.waitFor(() => expect(view.container.textContent).toBe('City car'));
  });

  it('says any model without one, and shows the id of an unknown one', async () => {
    api();
    const any = await render(<ModelCell modelId={null} />);
    await vi.waitFor(() => expect(any.container.textContent).toBe('Any model'));
    any.unmount();
    const unknown = await render(<ModelCell modelId={99} />);
    await vi.waitFor(() => expect(unknown.container.textContent).toBe('#99'));
  });
});

describe('VehicleCell', () => {
  it('shows the plate of the allocated vehicle', async () => {
    api();
    const view = await render(<VehicleCell ctx={context({ booking: booking({ vehicleId: 'vehicle-1' }) })} />);
    await vi.waitFor(() => expect(view.container.textContent).toBe('AB-123-CD'));
  });

  it('shows the pre-allocated vehicle of the stored state', async () => {
    api();
    const view = await render(
      <VehicleCell
        ctx={context({ state: stateDoc({ preallocatedVehicleId: 'vehicle-1', preallocatedPlate: 'ZZ-999-ZZ' }) })}
      />,
    );
    await vi.waitFor(() => expect(view.container.textContent).toBe('ZZ-999-ZZpre-allocated'));
  });

  it('waits for the state, unless it failed, then shows a dash', async () => {
    api();
    const loading = await render(<VehicleCell ctx={context({ state: undefined })} />);
    await vi.waitFor(() => expect(loading.container.querySelector('[data-skeleton]')).not.toBeNull());
    loading.unmount();
    const failed = await render(<VehicleCell ctx={context({ state: undefined })} />, {
      value: { statesFailed: true },
    });
    await vi.waitFor(() => expect(failed.container.textContent).toBe('–'));
  });
});

describe('Plate', () => {
  it('shows a plate', async () => {
    const view = await render(<Plate plate="AB-123-CD" />, { api: fakeBo().api });
    await vi.waitFor(() => expect(view.container.textContent).toBe('AB-123-CD'));
  });
});
