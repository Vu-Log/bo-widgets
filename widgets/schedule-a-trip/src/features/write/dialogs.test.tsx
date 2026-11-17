import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBo, jsonResponse } from '../../test/fake-bo';
import { booking, buttonNamed, context, fieldLabelled, renderInSection, typeInto } from '../../test/section';
import { stubVulogApi, type ApiCall } from '../../test/vulog-api';
import { ConfirmDialog, EditModelDialog, EditTripDialog } from './dialogs';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

/** A fake API that records the writes and answers them with `status`. */
function api(status = 200) {
  const writes: ApiCall[] = [];
  stubVulogApi((call) => {
    if (call.path.endsWith('/vehicles/models')) return jsonResponse([{ id: 7, name: 'City car' }, { id: 8, name: 'Van' }]);
    if (call.path === 'fleetmanager/public/fleets/FLEET-1/vehicles') return jsonResponse([]);
    if (call.init?.method === 'POST' || call.init?.method === 'DELETE') {
      writes.push(call);
      return new Response(null, { status });
    }
    return undefined;
  });
  return writes;
}

const future = context({ booking: booking({ startDate: '2099-03-10T10:00:00Z', plannedReturnDate: '2099-03-10T18:00:00Z' }) });

describe('EditTripDialog', () => {
  it('sends the fields changed only, with the model, then closes', async () => {
    const writes = api();
    const onClose = vi.fn();
    const bo = fakeBo();
    const view = await renderInSection(<EditTripDialog ctx={future} onClose={onClose} />, { api: bo.api });
    unmount = view.unmount;
    await vi.waitFor(() => expect(fieldLabelled('Radius (m)')).toBeDefined());
    expect(buttonNamed('Save')?.disabled).toBe(true);

    typeInto(fieldLabelled('Radius (m)')!, '800');
    typeInto(fieldLabelled('Notes of the customer')!, 'Child seat');
    await vi.waitFor(() => expect(buttonNamed('Save')?.disabled).toBe(false));
    buttonNamed('Save')?.click();

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(writes[0]?.path).toBe('user/scheduleATrip/fleets/FLEET-1/bookingrequests/booking-1');
    expect(JSON.parse(String(writes[0]?.init?.body))).toEqual({ id: 'booking-1', modelId: 7, notes: 'Child seat', radius: 800 });
    await vi.waitFor(() => expect(bo.api.notify).toHaveBeenCalledWith({ message: 'Booking updated.', severity: 'success' }));
  });

  it('refuses a past start, a return before the start and a wrong radius', async () => {
    api();
    const view = await renderInSection(<EditTripDialog ctx={future} onClose={vi.fn()} />, { value: { timeZone: 'UTC' } });
    unmount = view.unmount;
    await vi.waitFor(() => expect(fieldLabelled('Start')).toBeDefined());
    typeInto(fieldLabelled('Start')!, '2000-01-01T10:00');
    await vi.waitFor(() => expect(document.body.textContent).toContain('The start must be in the future.'));
    typeInto(fieldLabelled('Start')!, '2099-03-11T10:00');
    await vi.waitFor(() => expect(document.body.textContent).toContain('The return must be after the start.'));
    typeInto(fieldLabelled('Radius (m)')!, '0');
    await vi.waitFor(() => expect(document.body.textContent).toContain('A whole number of meters'));
    expect(buttonNamed('Save')?.disabled).toBe(true);
  });

  it('keeps the dialog open with the failure', async () => {
    api(403);
    const onClose = vi.fn();
    const view = await renderInSection(<EditTripDialog ctx={future} onClose={onClose} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(fieldLabelled('Radius (m)')).toBeDefined());
    typeInto(fieldLabelled('Radius (m)')!, '800');
    await vi.waitFor(() => expect(buttonNamed('Save')?.disabled).toBe(false));
    buttonNamed('Save')?.click();
    await vi.waitFor(() => expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('not allowed'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('EditModelDialog', () => {
  it('changes the model to any', async () => {
    const writes = api();
    const onClose = vi.fn();
    const view = await renderInSection(<EditModelDialog ctx={future} onClose={onClose} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(document.body.querySelector('[role="combobox"]')).not.toBeNull());
    expect(buttonNamed('Save')?.disabled).toBe(true);
    document.body.querySelector<HTMLElement>('[role="combobox"]')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await vi.waitFor(() => expect(document.body.querySelectorAll('[role="option"]').length).toBe(3));
    [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent === 'Any model')?.click();
    await vi.waitFor(() => expect(buttonNamed('Save')?.disabled).toBe(false));
    buttonNamed('Save')?.click();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(JSON.parse(String(writes[0]?.init?.body))).toEqual({ id: 'booking-1', modelId: null });
  });
});

describe('ConfirmDialog', () => {
  it('cancels a booking once confirmed', async () => {
    const writes = api();
    const onClose = vi.fn();
    const bo = fakeBo();
    const view = await renderInSection(<ConfirmDialog kind="cancel" ctx={future} onClose={onClose} />, { api: bo.api });
    unmount = view.unmount;
    await vi.waitFor(() => expect(document.body.textContent).toContain('Cancel this booking?'));
    buttonNamed('Cancel the booking')?.click();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(writes.map((call) => call.path)).toEqual(['user/scheduleATrip/fleets/FLEET-1/bookingrequests/cancel/booking-1']);
    await vi.waitFor(() => expect(bo.api.notify).toHaveBeenCalledWith({ message: 'Booking cancelled.', severity: 'success' }));
  });

  it('takes the vehicle back', async () => {
    const writes = api();
    const onClose = vi.fn();
    const ctx = context({ booking: booking({ vehicleId: 'v-1' }) });
    const view = await renderInSection(<ConfirmDialog kind="deallocate" ctx={ctx} onClose={onClose} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(buttonNamed('Take the vehicle back')).toBeDefined());
    buttonNamed('Take the vehicle back')?.click();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(writes[0]).toMatchObject({ path: 'user/scheduledBooking/fleets/FLEET-1/bookingrequests/booking-1/vehicles/v-1', init: { method: 'DELETE' } });
  });

  it('removes a pre-allocation', async () => {
    api();
    const onClose = vi.fn();
    const view = await renderInSection(<ConfirmDialog kind="remove-preallocation" ctx={future} onClose={onClose} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(buttonNamed('Remove')).toBeDefined());
    buttonNamed('Remove')?.click();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows a refusal and stays open', async () => {
    api(403);
    const onClose = vi.fn();
    const view = await renderInSection(<ConfirmDialog kind="cancel" ctx={future} onClose={onClose} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(buttonNamed('Cancel the booking')).toBeDefined());
    buttonNamed('Cancel the booking')?.click();
    await vi.waitFor(() => expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('not allowed'));
    expect(onClose).not.toHaveBeenCalled();
    buttonNamed('Cancel')?.click();
    expect(onClose).toHaveBeenCalled();
  });
});
