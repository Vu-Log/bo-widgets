import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../test/fake-bo';
import { listBookingRequests, MAX_BOOKING_PAGE_SIZE } from './schedule-a-trip';

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
