// The rules of the write feature, then its flows wired through the real section (features,
// queries, operations, storage): only the back office, fetch and the IntersectionObserver are faked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../../i18n';
import { BOOKINGS_COLLECTION } from '../../storage/booking-state';
import { fakeBo, jsonResponse } from '../../test/fake-bo';
import { installFakeIntersectionObserver } from '../../test/intersection-observer';
import { renderInWidget } from '../../test/render';
import { booking, buttonNamed, context, fieldLabelled, renderInSection, stateDoc, typeInto } from '../../test/section';
import { apiBooking, fleetApi, stubVulogApi, type ApiCall } from '../../test/vulog-api';
import { BookingSection } from '../BookingSection';
import { canPreallocate, createWriteFeature, hostOf, writeActions, WriteHost } from '.';
import { createDialogStore } from './store';

const now = new Date('2026-03-10T08:00:00Z');
const deps = () => {
  const store = createDialogStore();
  return { t: createI18n('en_GB').t, store, now: () => now, Host: hostOf(store) };
};
const ids = (ctx: Parameters<typeof writeActions>[0]) => writeActions(ctx, deps()).map((action) => action.id);

describe('writeActions', () => {
  it('allows editing, allocating, pre-allocating and cancelling a booking to come', () => {
    expect(ids(context())).toEqual(['edit-trip', 'edit-model', 'allocate', 'preallocate', 'cancel']);
  });

  it('allows changing or removing a pre-allocation', () => {
    const ctx = context({ state: stateDoc({ preallocatedVehicleId: 'v-1' }) });
    expect(ids(ctx)).toEqual(['edit-trip', 'edit-model', 'allocate', 'preallocate', 'remove-preallocation', 'cancel']);
    expect(writeActions(ctx, deps()).find((action) => action.id === 'preallocate')?.label).toBe('Change the pre-allocated vehicle');
  });

  it('allows taking back the vehicle of an allocated or ongoing booking, not changing its model', () => {
    expect(ids(context({ booking: booking({ vehicleId: 'v-1' }) }))).toEqual(['edit-trip', 'deallocate', 'cancel']);
    expect(ids(context({ tab: 'ongoing', booking: booking({ vehicleId: 'v-1' }) }))).toEqual(['deallocate']);
  });

  it('allows nothing on a completed or cancelled booking', () => {
    expect(ids(context({ tab: 'completed' }))).toEqual([]);
    expect(ids(context({ tab: 'cancelled' }))).toEqual([]);
  });

  it('does not cancel a booking that started', () => {
    expect(ids(context({ booking: booking({ startDate: '2026-03-10T07:00:00Z' }) }))).not.toContain('cancel');
  });

  it('opens the dialog of an action', () => {
    const d = deps();
    const ctx = context();
    writeActions(ctx, d).find((action) => action.id === 'cancel')?.run(ctx);
    expect(d.store.get()).toEqual({ kind: 'cancel', ctx });
  });
});

describe('canPreallocate', () => {
  it('needs the stored state read, not handled by the scheduler, not archived', () => {
    expect(canPreallocate(context(), now)).toBe(true);
    expect(canPreallocate(context({ state: undefined }), now)).toBe(false);
    expect(canPreallocate(context({ state: stateDoc({ allocationProcessed: true }) }), now)).toBe(false);
    expect(
      canPreallocate(context({ booking: booking({ startDate: '2024-01-01T00:00:00Z', plannedReturnDate: null }) }), now),
    ).toBe(false);
    expect(canPreallocate(context({ booking: booking({ vehicleId: 'v' }) }), now)).toBe(false);
  });
});

describe('createWriteFeature', () => {
  it('gives "Pre-allocate" to a booking to come and "Allocate" to one in alert, nothing once it has a vehicle', () => {
    const feature = createWriteFeature(deps());
    expect(feature.primaryAction?.(context())?.id).toBe('preallocate');
    expect(feature.primaryAction?.(context({ tab: 'alert' }))?.id).toBe('allocate');
    expect(feature.primaryAction?.(context({ state: stateDoc({ preallocatedVehicleId: 'v' }) }))).toBeNull();
    expect(feature.primaryAction?.(context({ booking: booking({ vehicleId: 'v' }) }))).toBeNull();
    expect(feature.primaryAction?.(context({ tab: 'completed' }))).toBeNull();
    expect(feature.detailCards?.map((card) => [card.id, card.order])).toEqual([['write-actions', 5]]);
  });
});

describe('WriteHost', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => {
    unmount?.();
    vi.restoreAllMocks();
  });

  it('renders the dialog open, and nothing without one', async () => {
    stubVulogApi(() => jsonResponse([]));
    const store = createDialogStore();
    const view = await renderInSection(<WriteHost store={store} />);
    unmount = view.unmount;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    for (const [kind, title] of [
      ['edit-trip', 'Change the trip'],
      ['edit-model', 'Change the model'],
      ['allocate', 'Allocate a vehicle'],
      ['preallocate', 'Pre-allocate a vehicle'],
      ['cancel', 'Cancel this booking?'],
      ['deallocate', 'Take the vehicle back?'],
      ['remove-preallocation', 'Remove the pre-allocation?'],
    ] as const) {
      store.open({ kind, ctx: context() });
      await vi.waitFor(() => expect(document.body.querySelector('#write-dialog-title')?.textContent).toBe(title));
    }
    store.open({ kind: 'create' });
    await vi.waitFor(() => expect(document.body.querySelector('#write-dialog-title')?.textContent).toBe('New booking'));
    store.close();
    await vi.waitFor(() => expect(document.body.querySelector('#write-dialog-title')).toBeNull());
  });
});

describe('the write flows in the section', () => {
  let unmount: (() => void) | undefined;
  beforeEach(() => installFakeIntersectionObserver());
  afterEach(() => {
    unmount?.();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  const routed = () => {
    const bo = fakeBo({ getContext: async () => ({ fleetId: 'FLEET-1', locale: 'en_GB', basename: '/', timezone: 'UTC' }) });
    const navigate = vi.fn(async ({ path }: { path: string }) => {
      const resolved = new URL(path, 'https://bo.example.com/').pathname;
      queueMicrotask(() => bo.emit('routeChanged', { pathname: resolved, search: '', hash: '' }));
      return { path: resolved };
    });
    Object.assign(bo.api, { navigate });
    return { ...bo, navigate };
  };

  it('pre-allocates a vehicle from the row, then shows it in the list', async () => {
    const writes: ApiCall[] = [];
    stubVulogApi(
      fleetApi(
        {
          bookings: { PENDING: [apiBooking({ startDate: '2099-03-10T10:00:00Z', plannedReturnDate: null })] },
          catalog: [{ id: 'near', plate: 'AA-001-AA', model: { id: 7, name: 'City car' }, serviceIds: ['service-1'] }],
          vehicles: [{ id: 'near', vehicle_status: 0, location: { latitude: 48.857, longitude: 2.353 } }],
        },
        (call) => {
          if (call.init?.method !== 'POST' || call.path.endsWith('users/list')) return undefined;
          writes.push(call);
          return new Response(null, { status: 200 });
        },
      ),
    );
    const bo = routed();
    const view = await renderInWidget(<BookingSection />, bo.api);
    unmount = view.unmount;
    const row = () => view.container.querySelector<HTMLElement>('[data-row-id="booking-1"]');
    await vi.waitFor(() => expect(buttonNamed('Pre-allocate a vehicle', row() ?? undefined)).toBeDefined());

    buttonNamed('Pre-allocate a vehicle', row()!)?.click();
    await vi.waitFor(() => expect(buttonNamed('Pre-allocate')).toBeDefined());
    buttonNamed('Pre-allocate')?.click();

    await vi.waitFor(() => expect(row()?.textContent).toContain('AA-001-AApre-allocated'));
    expect(writes.map((call) => call.path)).toEqual(['fleetmanager/public/fleets/FLEET-1/vehicles/near/disable']);
    expect(JSON.parse(String(writes[0]?.init?.body))).toEqual({ subStatus: 'Schedule a trip booking-1' });
    expect(bo.storage.docs(BOOKINGS_COLLECTION).get('booking-1')?.value).toMatchObject({ preallocatedVehicleId: 'near' });
    expect(buttonNamed('Pre-allocate a vehicle', row()!)).toBeUndefined();
  });

  it('creates a booking from the header and opens it', async () => {
    stubVulogApi(
      fleetApi({ bookings: { PENDING: [] } }, (call) => {
        if (call.path.startsWith('search/')) return jsonResponse([{ type: 'user', id: 'user-1', firstname: 'Jane', lastname: 'Doe' }]);
        if (call.path === 'user/fleets/FLEET-1/serviceRegistrationOverview') {
          return jsonResponse([
            {
              catalog: [{ id: 'service-1', name: 'Cars', type: 'FREE_FLOATING', fleetId: 'FLEET-1', cityId: 'city-1' }],
              profiles: [{ profileId: 'profile-1', profileType: 'Single', profileStatus: 'APPROVED', services: { approved: ['service-1'] } }],
            },
          ]);
        }
        if (call.path === 'user/scheduleATrip/fleets/FLEET-1/bookingrequests' && call.init?.method === 'POST') {
          return jsonResponse({ id: 'booking-new' });
        }
        if (call.path === 'user/scheduleATrip/fleets/FLEET-1/bookingrequests/booking-new') {
          return jsonResponse(apiBooking({ id: 'booking-new', startDate: '2099-03-10T08:00:00Z' }));
        }
        return undefined;
      }),
    );
    const bo = routed();
    const view = await renderInWidget(<BookingSection />, bo.api);
    unmount = view.unmount;
    await vi.waitFor(() => expect(buttonNamed('New booking', view.container)).toBeDefined());
    buttonNamed('New booking', view.container)?.click();
    await vi.waitFor(() => expect(document.body.querySelector('#write-dialog-title')?.textContent).toBe('New booking'));

    const customer = fieldLabelled('Customer') as HTMLInputElement;
    customer.focus();
    typeInto(customer, 'jane');
    await vi.waitFor(() => expect(document.body.querySelector('[role="option"]')).not.toBeNull(), { timeout: 3000 });
    document.body.querySelector<HTMLElement>('[role="option"]')?.click();
    await vi.waitFor(() => expect(buttonNamed('Next')?.disabled).toBe(false));
    buttonNamed('Next')?.click();
    await vi.waitFor(() => expect(fieldLabelled('Latitude')).toBeDefined());
    typeInto(fieldLabelled('Start')!, '2099-03-10T08:00');
    typeInto(fieldLabelled('Planned return')!, '');
    typeInto(fieldLabelled('Latitude')!, '48.8566');
    typeInto(fieldLabelled('Longitude')!, '2.3522');
    await vi.waitFor(() => expect(buttonNamed('Next')?.disabled).toBe(false));
    buttonNamed('Next')?.click();
    await vi.waitFor(() => expect(buttonNamed('Create the booking')).toBeDefined());
    buttonNamed('Create the booking')?.click();

    await vi.waitFor(() =>
      expect(document.body.querySelector('[role="dialog"][aria-label="Booking details"]')?.textContent).toContain('#booking-new'),
    );
    expect(bo.navigate).toHaveBeenLastCalledWith({ path: 'booking-new' });
    await vi.waitFor(() => expect(bo.api.notify).toHaveBeenCalledWith({ message: 'Booking created.', severity: 'success' }));
  });
});
