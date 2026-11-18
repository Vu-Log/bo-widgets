import { connect } from '@vulog/bo-widget-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveVehicle } from '../../api/vehicles';
import { bookingsCollection, BOOKINGS_COLLECTION, createBookingState } from '../../storage/booking-state';
import { fakeBo, jsonResponse } from '../../test/fake-bo';
import { booking, buttonNamed, context, renderInSection, stateDoc } from '../../test/section';
import { stubVulogApi, type ApiCall } from '../../test/vulog-api';
import { pickableVehicles, VehiclePickerDialog } from './VehiclePicker';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

const live = (id: string, overrides: Partial<LiveVehicle> = {}): LiveVehicle => ({
  id,
  plate: null,
  status: 'AVAILABLE',
  location: { latitude: 48.8566, longitude: 2.3522 },
  autonomy: null,
  energyLevel: null,
  km: null,
  outOfServiceReason: null,
  tripId: null,
  ...overrides,
});

describe('pickableVehicles', () => {
  const held = live('v-1', { status: 'OUT_OF_SERVICE', outOfServiceReason: 'Schedule a trip booking-1' });

  it('counts the vehicle held for the booking as available to allocate it', () => {
    expect(pickableVehicles([held, live('v-2')], 'booking-1', 'v-1', 'allocate').map((v) => [v.id, v.status])).toEqual([
      ['v-1', 'AVAILABLE'],
      ['v-2', 'AVAILABLE'],
    ]);
  });

  it('leaves out the pre-allocated vehicle when pre-allocating another', () => {
    expect(pickableVehicles([held, live('v-2')], 'booking-1', 'v-1', 'preallocate').map((v) => v.id)).toEqual(['v-2']);
  });

  it('keeps a pre-allocated vehicle held for something else as it is', () => {
    const other = live('v-1', { status: 'OUT_OF_SERVICE', outOfServiceReason: 'Repair' });
    expect(pickableVehicles([other], 'booking-1', 'v-1', 'allocate')[0]?.status).toBe('OUT_OF_SERVICE');
  });
});

/** The vehicles of a fleet around the pickup point, and the writes received. */
function api(options: { busy?: boolean; fail?: boolean } = {}) {
  const writes: ApiCall[] = [];
  stubVulogApi((call) => {
    const { path } = call;
    if (path === 'user/vehicle/fleets/FLEET-1/vehicles') {
      return jsonResponse([
        { id: 'near', plate: 'AA-001-AA', model: { id: 7, name: 'City car' }, serviceIds: ['service-1'] },
        { id: 'far', plate: 'AA-002-AA', model: { id: 7, name: 'City car' }, serviceIds: ['service-1'] },
        { id: 'other-model', plate: 'AA-003-AA', model: { id: 8, name: 'Van' }, serviceIds: ['service-1'] },
      ]);
    }
    if (path === 'fleetmanager/public/fleets/FLEET-1/vehicles') {
      return jsonResponse([
        { id: 'near', vehicle_status: 0, location: { latitude: 48.857, longitude: 2.353 }, energyLevel: 80, km: 1200 },
        { id: 'far', vehicle_status: 0, location: { latitude: 48.9, longitude: 2.4 } },
        { id: 'other-model', vehicle_status: 0, location: { latitude: 48.857, longitude: 2.353 } },
      ]);
    }
    if (path.endsWith('/active')) return jsonResponse(options.busy ? [{ journeyId: 'trip-1' }] : []);
    if (call.init?.method === 'POST') {
      writes.push(call);
      return new Response(null, { status: options.fail ? 409 : 200 });
    }
    return undefined;
  });
  return writes;
}

describe('VehiclePickerDialog', () => {
  it('lists the vehicles of the service and model in the radius, then the closest outside', async () => {
    api();
    const view = await renderInSection(<VehiclePickerDialog mode="preallocate" ctx={context()} onClose={vi.fn()} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(document.body.textContent).toContain('AA-001-AA'));
    expect(document.body.textContent).toContain('In the radius (1)');
    expect(document.body.textContent).not.toContain('AA-003-AA');
    expect(document.body.textContent).toContain('Energy 80 %');
    expect(document.body.querySelectorAll('[data-marker]')).toHaveLength(2);
    buttonNamed('10 closest outside')?.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('AA-002-AA'));
    expect(document.body.querySelector('ul[aria-label]')?.textContent).not.toContain('AA-001-AA');
  });

  it('pre-allocates the vehicle chosen and records it', async () => {
    const writes = api();
    const bo = fakeBo();
    const onClose = vi.fn();
    const view = await renderInSection(<VehiclePickerDialog mode="preallocate" ctx={context()} onClose={onClose} />, { api: bo.api });
    unmount = view.unmount;
    await vi.waitFor(() => expect(buttonNamed('Pre-allocate')).toBeDefined());
    buttonNamed('Pre-allocate')?.click();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(writes.map((call) => call.path)).toEqual(['fleetmanager/public/fleets/FLEET-1/vehicles/near/disable']);
    expect(bo.storage.docs(BOOKINGS_COLLECTION).get('booking-1')?.value).toMatchObject({ preallocatedVehicleId: 'near', preallocatedPlate: 'AA-001-AA' });
    await vi.waitFor(() => expect(bo.api.notify).toHaveBeenCalledWith({ message: 'AA-001-AA pre-allocated.', severity: 'success' }));
  });

  it('allocates the vehicle chosen with the service of the booking', async () => {
    const writes = api();
    const onClose = vi.fn();
    const view = await renderInSection(<VehiclePickerDialog mode="allocate" ctx={context({ tab: 'alert' })} onClose={onClose} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(buttonNamed('Allocate')?.disabled).toBe(false));
    buttonNamed('Allocate')?.click();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(writes.map((call) => `${call.path}?${call.query}`)).toEqual([
      'user/scheduleATrip/fleets/FLEET-1/bookingrequests/booking-1/allocate/near?serviceId=service-1',
    ]);
  });

  it('refuses to allocate while the customer has a trip in progress', async () => {
    api({ busy: true });
    const view = await renderInSection(<VehiclePickerDialog mode="allocate" ctx={context()} onClose={vi.fn()} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(document.body.textContent).toContain('has a trip in progress'));
    expect(buttonNamed('Allocate')?.disabled).toBe(true);
  });

  it('does not allocate while the trip in progress of the customer cannot be checked', async () => {
    stubVulogApi((call) =>
      call.path.endsWith('/active') ? new Response('', { status: 500 }) : call.path.includes('vehicles') ? jsonResponse([]) : undefined,
    );
    const view = await renderInSection(<VehiclePickerDialog mode="allocate" ctx={context()} onClose={vi.fn()} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(document.body.textContent).toContain('could not be checked'));
  });

  it('shows why a pre-allocation failed, logs it and stays open', async () => {
    api({ fail: true });
    const onClose = vi.fn();
    const view = await renderInSection(<VehiclePickerDialog mode="preallocate" ctx={context()} onClose={onClose} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(buttonNamed('Pre-allocate')).toBeDefined());
    buttonNamed('Pre-allocate')?.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('HTTP 409'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says when the booking has no pickup point, or when the vehicles cannot be read', async () => {
    api();
    const view = await renderInSection(
      <VehiclePickerDialog mode="preallocate" ctx={context({ booking: booking({ latitude: null }) })} onClose={vi.fn()} />,
    );
    await vi.waitFor(() => expect(document.body.textContent).toContain('no pickup point'));
    view.unmount();
    vi.restoreAllMocks();
    stubVulogApi(() => new Response('', { status: 403 }));
    const failed = await renderInSection(<VehiclePickerDialog mode="preallocate" ctx={context()} onClose={vi.fn()} />);
    unmount = failed.unmount;
    await vi.waitFor(() => expect(document.body.textContent).toContain('You are not allowed'));
  });

  it('allocates the vehicle pre-allocated for the booking', async () => {
    const writes: ApiCall[] = [];
    stubVulogApi((call) => {
      if (call.path === 'user/vehicle/fleets/FLEET-1/vehicles') return jsonResponse([{ id: 'held', plate: 'HH-001-HH', serviceIds: ['service-1'], model: { id: 7, name: 'x' } }]);
      if (call.path === 'fleetmanager/public/fleets/FLEET-1/vehicles') {
        return jsonResponse([{ id: 'held', vehicle_status: 2, outOfServiceReason: 'Schedule a trip booking-1', location: { latitude: 48.857, longitude: 2.353 } }]);
      }
      if (call.path.endsWith('/active')) return jsonResponse([]);
      if (call.init?.method === 'POST') {
        writes.push(call);
        return new Response(null, { status: 200 });
      }
      return undefined;
    });
    const bo = fakeBo();
    const client = await connect({ vulogBo: bo.api });
    await createBookingState(bookingsCollection(client.storage), 'booking-1', { fleetId: 'FLEET-1', patch: { preallocatedVehicleId: 'held' } });
    client.disconnect();
    const onClose = vi.fn();
    const view = await renderInSection(
      <VehiclePickerDialog mode="allocate" ctx={context({ state: stateDoc({ preallocatedVehicleId: 'held' }) })} onClose={onClose} />,
      { api: bo.api },
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(buttonNamed('Allocate')?.disabled).toBe(false));
    buttonNamed('Allocate')?.click();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(writes.map((call) => call.path)).toEqual([
      'fleetmanager/public/fleets/FLEET-1/vehicles/held/enable',
      'user/scheduleATrip/fleets/FLEET-1/bookingrequests/booking-1/allocate/held',
    ]);
  });
});
