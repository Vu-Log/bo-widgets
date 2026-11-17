import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../test/fake-bo';
import {
  allocateVehicle,
  cancelBookingRequest,
  createBookingRequest,
  deallocateVehicle,
  getBookingRequest,
  hasTripInProgress,
  listBookingRequests,
  MAX_BOOKING_PAGE_SIZE,
  toApiDate,
  updateBookingRequest,
} from './schedule-a-trip';

const params = {
  fleetId: 'FLEET-1',
  status: 'PENDING',
  page: 0,
  size: 50,
  sort: { field: 'startDate', direction: 'ASC' },
} as const;

const apiBooking = {
  id: 'booking-1',
  status: 'PENDING',
  creationDate: '2026-03-01T10:00:00Z',
  startDate: '2026-03-10T10:00:00Z',
  endDate: '2026-03-10T18:00:00Z',
  plannedReturnDate: null,
  userId: 'user-9',
  profileId: 'profile-9',
  serviceId: 'service-1',
  modelId: 7,
  latitude: 48.85,
  longitude: 2.35,
  radius: 500,
  unexpected: 'dropped',
};

describe('listBookingRequests', () => {
  it('reads a page and the totals of its headers', async () => {
    const authFetch = vi.fn<AuthFetch>(async () =>
      jsonResponse([apiBooking], { headers: { totalelements: '412', totalpages: '9' } }),
    );
    const signal = new AbortController().signal;

    const result = await listBookingRequests(authFetch, params, signal);

    expect(authFetch).toHaveBeenCalledWith(
      'user/scheduleATrip/fleets/FLEET-1/bookingrequests/status/PENDING?page=0&size=50&sort=startDate%2CASC',
      { signal },
    );
    expect(result).toEqual({
      ok: true,
      data: {
        totalElements: 412,
        totalPages: 9,
        items: [
          {
            id: 'booking-1',
            status: 'PENDING',
            creationDate: '2026-03-01T10:00:00Z',
            startDate: '2026-03-10T10:00:00Z',
            endDate: '2026-03-10T18:00:00Z',
            plannedReturnDate: null,
            cancellationDate: null,
            userId: 'user-9',
            profileId: 'profile-9',
            serviceId: 'service-1',
            modelId: 7,
            vehicleId: null,
            journeyId: null,
            completed: false,
            latitude: 48.85,
            longitude: 2.35,
            radius: 500,
            notes: null,
            failureReason: null,
          },
        ],
      },
    });
  });

  it('gives null totals when the headers are absent or unreadable', async () => {
    const authFetch = vi.fn<AuthFetch>(async () =>
      jsonResponse([], { headers: { totalelements: 'many' } }),
    );
    const result = await listBookingRequests(authFetch, params);
    expect(result).toEqual({
      ok: true,
      data: { items: [], totalElements: null, totalPages: null },
    });
  });

  it('maps a 403 to not-allowed', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('', { status: 403 }));
    expect(await listBookingRequests(authFetch, params)).toEqual({
      ok: false,
      error: { kind: 'not-allowed', status: 403 },
    });
  });

  it('reports an unreadable date as an unexpected response', async () => {
    const authFetch = vi.fn<AuthFetch>(async () =>
      jsonResponse([{ ...apiBooking, startDate: 'tomorrow' }]),
    );
    const result = await listBookingRequests(authFetch, params);
    expect(result.ok === false && result.error.kind).toBe('invalid-response');
  });

  it('reports a booking without an id as an unexpected response', async () => {
    const authFetch = vi.fn<AuthFetch>(async () =>
      jsonResponse([{ ...apiBooking, id: undefined }]),
    );
    const result = await listBookingRequests(authFetch, params);
    expect(result.ok === false && result.error.kind).toBe('invalid-response');
  });

  it.each([
    { page: -1 },
    { page: 1.5 },
    { size: 0 },
    { size: MAX_BOOKING_PAGE_SIZE + 1 },
    { sort: { field: 'startDate&size=9999', direction: 'ASC' as const } },
  ])('refuses %o without calling the API', async (override) => {
    const authFetch = vi.fn<AuthFetch>();
    const result = await listBookingRequests(authFetch, { ...params, ...override });
    expect(result.ok === false && result.error.kind).toBe('invalid-request');
    expect(authFetch).not.toHaveBeenCalled();
  });
});

describe('getBookingRequest', () => {
  it('reads one booking with the list shape', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse(apiBooking));
    const result = await getBookingRequest(authFetch, 'FLEET-1', 'booking/1');
    expect(authFetch).toHaveBeenCalledWith(
      'user/scheduleATrip/fleets/FLEET-1/bookingrequests/booking%2F1',
      { signal: undefined },
    );
    expect(result.ok && result.data).toMatchObject({ id: 'booking-1', radius: 500, notes: null });
    expect(result.ok && 'unexpected' in result.data).toBe(false);
  });

  it('maps a 404 to not-found', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('', { status: 404 }));
    const result = await getBookingRequest(authFetch, 'FLEET-1', 'booking-1');
    expect(result).toEqual({ ok: false, error: { kind: 'not-found', status: 404 } });
  });
});

describe('the writes', () => {
  const ok = () => vi.fn<AuthFetch>(async () => new Response(null, { status: 200 }));
  const call = (authFetch: ReturnType<typeof ok>) => {
    const [path, init] = authFetch.mock.calls[0] ?? [];
    return { path, init, body: init?.body ? JSON.parse(String(init.body)) : undefined };
  };

  it('formats the dates in UTC to the second', () => {
    expect(toApiDate(new Date('2026-03-10T08:00:00.123Z'))).toBe('2026-03-10T08:00:00Z');
  });

  it('creates a confirmed booking and gives its id', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse({ id: 'booking-9', status: 'CONFIRMED' }));
    const result = await createBookingRequest(authFetch, 'FLEET-1', {
      userId: 'user-1',
      profileId: 'profile-1',
      serviceId: 'service-1',
      cityId: 'city-1',
      start: new Date('2026-03-10T08:00:00Z'),
      plannedReturn: null,
      modelId: null,
      latitude: 48.85,
      longitude: 2.35,
      radius: 500,
      notes: 'Child seat',
    });
    expect(result).toEqual({ ok: true, data: 'booking-9' });
    const { path, init, body } = call(authFetch as never);
    expect(path).toBe('user/scheduleATrip/fleets/FLEET-1/bookingrequests');
    expect(init?.method).toBe('POST');
    expect(body).toEqual({
      cityId: 'city-1',
      latitude: 48.85,
      longitude: 2.35,
      profileId: 'profile-1',
      radius: 500,
      serviceId: 'service-1',
      startDate: '2026-03-10T08:00:00Z',
      plannedReturnDate: null,
      status: 'CONFIRMED',
      userId: 'user-1',
      warning: '',
      notes: 'Child seat',
      modelId: null,
    });
  });

  it('reports a refused creation, and an answer without id', async () => {
    const refused = vi.fn<AuthFetch>(async () => new Response('', { status: 400 }));
    const input = {
      userId: 'u', profileId: 'p', serviceId: 's', cityId: 'c', start: new Date(), plannedReturn: new Date(),
      modelId: 7, latitude: 1, longitude: 2, radius: 1, notes: '',
    };
    expect(await createBookingRequest(refused, 'FLEET-1', input)).toEqual({ ok: false, error: { kind: 'http', status: 400 } });
    const empty = vi.fn<AuthFetch>(async () => jsonResponse({}));
    const result = await createBookingRequest(empty, 'FLEET-1', input);
    expect(result.ok ? null : result.error.kind).toBe('invalid-response');
  });

  it('updates the fields changed only, always with the model', async () => {
    const authFetch = ok();
    await updateBookingRequest(authFetch, 'FLEET-1', 'booking-1', 7, {
      start: new Date('2026-03-10T08:00:00Z'),
      plannedReturn: null,
    });
    expect(call(authFetch).path).toBe('user/scheduleATrip/fleets/FLEET-1/bookingrequests/booking-1');
    expect(call(authFetch).body).toEqual({
      id: 'booking-1',
      modelId: 7,
      startDate: '2026-03-10T08:00:00Z',
      plannedReturnDate: null,
    });
    const other = ok();
    await updateBookingRequest(other, 'FLEET-1', 'booking-1', null, {
      notes: 'n',
      pickup: { latitude: 1, longitude: 2, radius: 300 },
      plannedReturn: new Date('2026-03-11T08:00:00Z'),
    });
    expect(call(other).body).toEqual({
      id: 'booking-1',
      modelId: null,
      plannedReturnDate: '2026-03-11T08:00:00Z',
      notes: 'n',
      latitude: 1,
      longitude: 2,
      radius: 300,
    });
  });

  it('cancels, allocates and deallocates with the routes of the back office', async () => {
    const cancel = ok();
    await cancelBookingRequest(cancel, 'FLEET-1', 'b/1');
    expect(call(cancel)).toMatchObject({ path: 'user/scheduleATrip/fleets/FLEET-1/bookingrequests/cancel/b%2F1', init: { method: 'POST' } });
    const allocate = ok();
    await allocateVehicle(allocate, 'FLEET-1', 'b-1', 'v-1', 'service 1');
    expect(call(allocate).path).toBe(
      'user/scheduleATrip/fleets/FLEET-1/bookingrequests/b-1/allocate/v-1?serviceId=service+1',
    );
    const deallocate = ok();
    await deallocateVehicle(deallocate, 'FLEET-1', 'b-1', 'v-1');
    expect(call(deallocate)).toMatchObject({
      path: 'user/scheduledBooking/fleets/FLEET-1/bookingrequests/b-1/vehicles/v-1',
      init: { method: 'DELETE' },
    });
  });

  it('reports a refused write', async () => {
    const refused = vi.fn<AuthFetch>(async () => new Response('', { status: 403 }));
    expect(await cancelBookingRequest(refused, 'FLEET-1', 'b-1')).toEqual({
      ok: false,
      error: { kind: 'not-allowed', status: 403 },
    });
  });
});

describe('hasTripInProgress', () => {
  it('says whether an active booking of the customer has a trip', async () => {
    const withTrip = vi.fn<AuthFetch>(async () => jsonResponse([{ journeyId: null }, { journeyId: 'trip-1' }]));
    expect(await hasTripInProgress(withTrip, 'FLEET-1', 'user-1')).toEqual({ ok: true, data: true });
    expect(withTrip.mock.calls[0]?.[0]).toBe('user/scheduleATrip/fleets/FLEET-1/bookingrequests/users/user-1/active');
    const without = vi.fn<AuthFetch>(async () => jsonResponse([{ journeyId: null }]));
    expect(await hasTripInProgress(without, 'FLEET-1', 'user-1')).toEqual({ ok: true, data: false });
  });

  it('keeps a failure', async () => {
    const failed = vi.fn<AuthFetch>(async () => new Response('', { status: 404 }));
    const result = await hasTripInProgress(failed, 'FLEET-1', 'user-1');
    expect(result.ok ? null : result.error.kind).toBe('not-found');
  });
});
