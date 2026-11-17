// Test helpers: a fake of the Vulog API behind `authFetch`, and neutral fixtures.
import { vi } from 'vitest';
import { API_BASE_URL, jsonResponse } from './fake-bo';

/** A request the fake API received: its path relative to the API, its query and its options. */
export interface ApiCall {
  readonly path: string;
  readonly query: URLSearchParams;
  readonly init: RequestInit | undefined;
}

/** Answers a request, or `undefined` for a 404. */
export type ApiHandler = (call: ApiCall) => Response | undefined | Promise<Response | undefined>;

/**
 * Stubs `fetch` with a fake of the Vulog API: each call to the API base URL goes to the handler,
 * with its path relative to the API. Any other URL (Mapbox…) gets a 404.
 *
 * @param handler - The answers.
 * @returns The spy of `fetch`.
 */
export function stubVulogApi(handler: ApiHandler) {
  const base = new URL(API_BASE_URL);
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
      return new Response('', { status: 404 });
    }
    const path = decodeURIComponent(url.pathname.slice(base.pathname.length));
    return (await handler({ path, query: url.searchParams, init })) ?? new Response('', { status: 404 });
  });
}

/** The paths of the calls a `fetch` spy received, relative to the API, with their query. */
export const calledPaths = (spy: { mock: { calls: unknown[][] } }): string[] =>
  spy.mock.calls.map(([input]) => {
    const url = new URL(String(input));
    return `${url.pathname.replace(new URL(API_BASE_URL).pathname, '')}${url.search}`;
  });

/** A booking as the list routes return it, with neutral values. */
export const apiBooking = (overrides: Record<string, unknown> = {}) => ({
  id: 'booking-1',
  status: 'PENDING',
  creationDate: '2026-02-01T10:00:00Z',
  startDate: '2026-03-10T10:00:00Z',
  endDate: null,
  plannedReturnDate: '2026-03-10T18:00:00Z',
  cancellationDate: null,
  userId: 'user-1',
  profileId: 'profile-1',
  serviceId: 'service-1',
  modelId: 7,
  vehicleId: null,
  journeyId: null,
  completed: false,
  latitude: 48.8566,
  longitude: 2.3522,
  radius: 500,
  notes: null,
  failureReason: null,
  ...overrides,
});

/** A customer as `users/list` returns it. */
export const apiUser = (id: string, lastName = 'Doe') => ({
  id,
  firstName: 'Jane',
  lastName,
  userName: `jane.${id}`,
  profiles: [
    { id: 'profile-1', type: 'Single' },
    { id: 'profile-2', type: 'Business', entity: { id: 'entity-1' } },
  ],
});

/** A page of bookings, with its totals. */
export const bookingPage = (items: readonly unknown[], totalPages = 1) =>
  jsonResponse(items, {
    headers: { totalelements: String(items.length), totalpages: String(totalPages) },
  });

/**
 * A fake API for a fleet: the pages of each status, the customers, the models, the vehicles and
 * the trips in progress. Override any route with `extra`.
 *
 * @param data - The bookings by status, and the trips in progress.
 * @param extra - Handled before the defaults.
 * @returns The handler.
 */
export function fleetApi(
  data: {
    readonly bookings?: Readonly<Record<string, readonly unknown[]>>;
    readonly trips?: readonly unknown[];
    readonly vehicles?: readonly unknown[];
    readonly catalog?: readonly unknown[];
  },
  extra?: ApiHandler,
): ApiHandler {
  return async (call) => {
    const answer = await extra?.(call);
    if (answer) return answer;
    const { path, init } = call;
    const status = /bookingrequests\/status\/(\w+)$/.exec(path)?.[1];
    if (status) {
      const items = data.bookings?.[status] ?? [];
      return call.query.get('size') === '1'
        ? jsonResponse(items.slice(0, 1), {
            headers: { totalelements: String(items.length), totalpages: String(items.length) },
          })
        : bookingPage(items);
    }
    const one = /bookingrequests\/([^/]+)$/.exec(path)?.[1];
    if (one && path.startsWith('user/scheduleATrip/')) {
      const found = Object.values(data.bookings ?? {})
        .flat()
        .find((booking) => (booking as { id: string }).id === one);
      return found ? jsonResponse(found) : undefined;
    }
    if (path === 'user/fleets/FLEET-1/users/list' && init?.method === 'POST') {
      const ids = JSON.parse(String(init.body)) as string[];
      return jsonResponse(ids.map((id) => apiUser(id)));
    }
    if (path === 'user/vehicle/fleets/FLEET-1/vehicles/models') {
      return jsonResponse([{ id: 7, name: 'City car' }]);
    }
    if (path === 'user/vehicle/fleets/FLEET-1/vehicles') return jsonResponse(data.catalog ?? []);
    if (path === 'fleetmanager/public/fleets/FLEET-1/vehicles') return jsonResponse(data.vehicles ?? []);
    if (path === 'fleetmanager/public/fleets/FLEET-1/book') return jsonResponse(data.trips ?? []);
    return undefined;
  };
}
