import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBo, jsonResponse } from '../../test/fake-bo';
import { buttonNamed, fieldLabelled, renderInSection, typeInto } from '../../test/section';
import { stubVulogApi, type ApiCall } from '../../test/vulog-api';
import { CreateBookingDialog } from './CreateBooking';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

const overview = (profiles: unknown[]) => [
  {
    userId: 'user-1',
    catalog: [
      { id: 'service-1', name: 'Cars', type: 'FREE_FLOATING', fleetId: 'FLEET-1', cityId: 'city-1' },
      { id: 'service-2', name: 'Stations', type: 'BOOKING', fleetId: 'FLEET-1', cityId: 'city-1' },
    ],
    profiles,
  },
];
const single = { profileId: 'profile-1', profileType: 'Single', profileStatus: 'APPROVED', services: { approved: ['service-1', 'service-2'] } };

function api(options: { profiles?: unknown[]; create?: number } = {}) {
  const writes: ApiCall[] = [];
  stubVulogApi((call) => {
    const { path } = call;
    if (path.startsWith('search/fleets/FLEET-1/search/')) {
      return jsonResponse([{ type: 'user', id: 'user-1', firstname: 'Jane', lastname: 'Doe', username: 'jane.doe' }]);
    }
    if (path === 'user/fleets/FLEET-1/serviceRegistrationOverview') return jsonResponse(overview(options.profiles ?? [single]));
    if (path.endsWith('/vehicles/models')) return jsonResponse([{ id: 7, name: 'City car' }, { id: 8, name: 'Van' }]);
    if (path === 'user/vehicle/fleets/FLEET-1/vehicles') return jsonResponse([{ id: 'v', plate: 'P', model: { id: 7, name: 'City car' }, serviceIds: ['service-1'] }]);
    if (path === 'user/scheduleATrip/fleets/FLEET-1/bookingrequests' && call.init?.method === 'POST') {
      writes.push(call);
      return options.create ? new Response('', { status: options.create }) : jsonResponse({ id: 'booking-new' });
    }
    return undefined;
  });
  return writes;
}

async function chooseCustomer() {
  await vi.waitFor(() => expect(fieldLabelled('Customer')).toBeDefined());
  const input = fieldLabelled('Customer') as HTMLInputElement;
  input.focus();
  typeInto(input, 'jane');
  await vi.waitFor(() => expect(document.body.querySelector('[role="option"]')).not.toBeNull(), { timeout: 3000 });
  document.body.querySelector<HTMLElement>('[role="option"]')?.click();
}

describe('CreateBookingDialog', () => {
  it('creates a booking in 3 steps, then opens it', async () => {
    const writes = api();
    const openDetail = vi.fn();
    const onClose = vi.fn();
    const bo = fakeBo();
    const view = await renderInSection(<CreateBookingDialog onClose={onClose} />, { api: bo.api, value: { openDetail, timeZone: 'UTC' } });
    unmount = view.unmount;

    await chooseCustomer();
    // One profile and one free floating service: both chosen at once.
    await vi.waitFor(() => expect(buttonNamed('Next')?.disabled).toBe(false));
    buttonNamed('Next')?.click();

    await vi.waitFor(() => expect(fieldLabelled('Latitude')).toBeDefined());
    expect(buttonNamed('Next')?.disabled).toBe(true);
    typeInto(fieldLabelled('Start')!, '2099-03-10T08:00');
    typeInto(fieldLabelled('Planned return')!, '');
    typeInto(fieldLabelled('Latitude')!, '48.8566');
    typeInto(fieldLabelled('Longitude')!, '2.3522');
    await vi.waitFor(() => expect(buttonNamed('Next')?.disabled).toBe(false));
    buttonNamed('Next')?.click();

    await vi.waitFor(() => expect(document.body.textContent).toContain('Summary'));
    expect(document.body.textContent).toContain('Jane Doe (jane.doe)');
    expect(document.body.textContent).toContain('Cars');
    typeInto(fieldLabelled('Notes of the customer')!, 'Child seat');
    buttonNamed('Create the booking')?.click();

    await vi.waitFor(() => expect(openDetail).toHaveBeenCalledWith('booking-new'));
    expect(onClose).toHaveBeenCalled();
    expect(JSON.parse(String(writes[0]?.init?.body))).toEqual({
      cityId: 'city-1',
      latitude: 48.8566,
      longitude: 2.3522,
      profileId: 'profile-1',
      radius: 500,
      serviceId: 'service-1',
      startDate: '2099-03-10T08:00:00Z',
      plannedReturnDate: null,
      status: 'CONFIRMED',
      userId: 'user-1',
      warning: '',
      notes: 'Child seat',
      modelId: null,
    });
  });

  it('lets the operator choose among several profiles', async () => {
    api({ profiles: [single, { profileId: 'profile-2', profileType: 'Business', profileStatus: 'APPROVED', services: { approved: [] } }] });
    const view = await renderInSection(<CreateBookingDialog onClose={vi.fn()} />);
    unmount = view.unmount;
    await chooseCustomer();
    await vi.waitFor(() => expect(document.body.querySelectorAll('input[type="radio"]')).toHaveLength(2));
    expect(buttonNamed('Next')?.disabled).toBe(true);
    document.body.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1]?.click();
    await vi.waitFor(() => expect(buttonNamed('Next')?.disabled).toBe(false));
    buttonNamed('Next')?.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('No free floating service'));
  });

  it('says when the customer has no profile to book with', async () => {
    api({ profiles: [{ ...single, profileStatus: 'ARCHIVED' }] });
    const view = await renderInSection(<CreateBookingDialog onClose={vi.fn()} />);
    unmount = view.unmount;
    await chooseCustomer();
    await vi.waitFor(() => expect(document.body.textContent).toContain('no profile a booking can be made with'));
  });

  it('shows a refused creation and stays open', async () => {
    api({ create: 400 });
    const onClose = vi.fn();
    const view = await renderInSection(<CreateBookingDialog onClose={onClose} />, { value: { timeZone: 'UTC' } });
    unmount = view.unmount;
    await chooseCustomer();
    await vi.waitFor(() => expect(buttonNamed('Next')?.disabled).toBe(false));
    buttonNamed('Next')?.click();
    await vi.waitFor(() => expect(fieldLabelled('Latitude')).toBeDefined());
    typeInto(fieldLabelled('Start')!, '2099-03-10T08:00');
    typeInto(fieldLabelled('Planned return')!, '2099-03-10T10:00');
    typeInto(fieldLabelled('Latitude')!, '48.8566');
    typeInto(fieldLabelled('Longitude')!, '2.3522');
    await vi.waitFor(() => expect(buttonNamed('Next')?.disabled).toBe(false));
    buttonNamed('Next')?.click();
    await vi.waitFor(() => expect(buttonNamed('Create the booking')).toBeDefined());
    buttonNamed('Create the booking')?.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('HTTP 400'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
