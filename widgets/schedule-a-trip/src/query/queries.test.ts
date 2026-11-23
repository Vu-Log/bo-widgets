import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query';
import { connect, type AuthFetch } from '@vulog/bo-widget-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

const disconnects: (() => void)[] = [];
import { ApiRequestError } from '../api/http';
import {
  bookingsCollection,
  BOOKINGS_COLLECTION,
  StorageRequestError,
} from '../storage/booking-state';
import { fakeBo, hostError, jsonResponse } from '../test/fake-bo';
import { PERSIST_MAX_AGE_MS } from './client';
import { isPersistedQueryKey, queryKeys } from './keys';
import {
  BOOKING_PAGE_SIZE,
  bookingCountQueryOptions,
  bookingPagesQueryOptions,
  bookingQueryOptions,
  bookingStateQueryOptions,
  confirmedBookingsQueryOptions,
  customersQueryOptions,
  fleetBookingStatesQueryOptions,
  invoiceQueryOptions,
  invoiceStaleTime,
  liveVehiclesQueryOptions,
  modelsQueryOptions,
  bookingAddressQueryOptions,
  seedBookingStates,
  tripsInProgressQueryOptions,
  vehicleCatalogQueryOptions,
} from './queries';

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const sort = { field: 'startDate', direction: 'ASC' } as const;

afterEach(() => {
  disconnects.splice(0).forEach((disconnect) => disconnect());
  vi.restoreAllMocks();
});

describe('modelsQueryOptions', () => {
  it('loads the models and keeps them as long as they are persisted', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse([{ id: 7, name: 'City car' }]));
    const options = modelsQueryOptions(authFetch, 'FLEET-1');

    expect(await newClient().fetchQuery(options)).toEqual([
      { id: 7, name: 'City car', brand: null, status: null, vehicleType: null },
    ]);
    expect(options.queryKey).toEqual(queryKeys.models('FLEET-1'));
    expect(options.gcTime).toBeGreaterThanOrEqual(PERSIST_MAX_AGE_MS);
  });

  it('fails with an ApiRequestError', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('', { status: 403 }));
    await expect(
      newClient().fetchQuery(modelsQueryOptions(authFetch, 'FLEET-1')),
    ).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe('bookingPagesQueryOptions', () => {
  const page = (count: number, headers: Record<string, string> = {}) =>
    jsonResponse(
      Array.from({ length: count }, (_, index) => ({
        id: `b-${index}`,
        status: 'PENDING',
        startDate: '2026-03-10T10:00:00Z',
      })),
      { headers },
    );

  it('loads page 0 of the AIMA status of the tab, then the next ones', async () => {
    const authFetch = vi
      .fn<AuthFetch>()
      .mockResolvedValueOnce(page(2, { totalelements: '4', totalpages: '2' }))
      .mockResolvedValueOnce(page(2, { totalelements: '4', totalpages: '2' }));
    const client = newClient();
    const options = bookingPagesQueryOptions(authFetch, {
      fleetId: 'FLEET-1',
      tab: 'alert',
      sort,
      pageSize: 2,
    });

    const first = await client.fetchInfiniteQuery(options);
    expect(first.pages[0]?.totalElements).toBe(4);
    expect(authFetch.mock.calls[0]?.[0]).toContain(
      '/status/ALERT?page=0&size=2&sort=startDate%2CASC',
    );
    expect(options.getNextPageParam(first.pages[0]!, first.pages, 0, first.pageParams)).toBe(1);

    const second = (await new InfiniteQueryObserver(client, options).fetchNextPage()).data;
    if (!second) throw new Error('no data');
    expect(second.pages).toHaveLength(2);
    expect(authFetch.mock.calls[1]?.[0]).toContain('page=1');
    expect(options.getNextPageParam(second.pages[1]!, second.pages, 1, [0, 1])).toBeUndefined();
  });

  it('stops on a short page when the totals are unknown', () => {
    const options = bookingPagesQueryOptions(vi.fn<AuthFetch>(), {
      fleetId: 'FLEET-1',
      tab: 'upcoming',
      sort,
    });
    const full = {
      items: Array.from({ length: BOOKING_PAGE_SIZE }),
      totalElements: null,
      totalPages: null,
    };
    const short = { items: [{}], totalElements: null, totalPages: null };
    expect(options.getNextPageParam(full as never, [], 3, [])).toBe(4);
    expect(options.getNextPageParam(short as never, [], 3, [])).toBeUndefined();
  });

  it('fails with an ApiRequestError', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('', { status: 500 }));
    await expect(
      newClient().fetchInfiniteQuery(
        bookingPagesQueryOptions(authFetch, { fleetId: 'FLEET-1', tab: 'cancelled', sort }),
      ),
    ).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe('customersQueryOptions', () => {
  it('loads the customers of the ids', async () => {
    const authFetch = vi.fn<AuthFetch>(async () =>
      jsonResponse([{ id: 'user-9', firstName: 'Jane' }]),
    );
    const customers = await newClient().fetchQuery(
      customersQueryOptions(authFetch, 'FLEET-1', ['user-9']),
    );
    expect(customers[0]?.firstName).toBe('Jane');
  });

  it('fails with an ApiRequestError', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('', { status: 403 }));
    await expect(
      newClient().fetchQuery(customersQueryOptions(authFetch, 'FLEET-1', ['u'])),
    ).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe('invoiceQueryOptions', () => {
  it('loads the invoices of the same task in one call of the list by ids', async () => {
    const authFetch = vi.fn<AuthFetch>(async () =>
      jsonResponse([
        { id: 'invoice-2', invoicesStatus: 'PENDING', amount: 10 },
        { id: 'invoice-1', invoicesStatus: 'PAID', amount: 20 },
      ]),
    );
    const client = newClient();
    const [first, second] = await Promise.all([
      client.fetchQuery(invoiceQueryOptions(authFetch, 'FLEET-1', 'invoice-1')),
      client.fetchQuery(invoiceQueryOptions(authFetch, 'FLEET-1', 'invoice-2')),
    ]);
    expect(first.status).toBe('PAID');
    expect(second.status).toBe('PENDING');
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(authFetch.mock.calls[0]?.[0]).toBe('user/billing/fleets/FLEET-1/invoices/list');
  });

  it('fails with an ApiRequestError for an invoice the list leaves out', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse([]));
    await expect(
      newClient().fetchQuery(invoiceQueryOptions(authFetch, 'FLEET-1', 'x')),
    ).rejects.toMatchObject({ error: { kind: 'not-found' } });
  });

  it('fails with an ApiRequestError when the list fails', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('', { status: 500 }));
    await expect(
      newClient().fetchQuery(invoiceQueryOptions(authFetch, 'FLEET-1', 'x')),
    ).rejects.toBeInstanceOf(ApiRequestError);
  });

  it('keeps a status fresh by how final it is', () => {
    const query = (status?: string) =>
      ({ state: { data: status ? { status } : undefined } }) as never;
    expect(invoiceStaleTime(query())).toBe(60_000);
    expect(invoiceStaleTime(query('PENDING'))).toBe(60_000);
    expect(invoiceStaleTime(query('PAID'))).toBe(300_000);
    expect(invoiceStaleTime(query('REFUNDED'))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('bookingStateQueryOptions', () => {
  const setup = async () => {
    const bo = fakeBo();
    const client = await connect({ vulogBo: bo.api });
    disconnects.push(() => client.disconnect());
    return { bo, collection: bookingsCollection(client.storage) };
  };

  it('caches null for a booking without a document, without asking again', async () => {
    const { bo, collection } = await setup();
    const client = newClient();
    const options = bookingStateQueryOptions(collection, 'FLEET-1', 'booking-1');

    expect(await client.fetchQuery(options)).toBeNull();
    expect(await client.fetchQuery(options)).toBeNull();
    expect(bo.storage.api.get).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(options.queryKey)?.status).toBe('success');
  });

  it('gives the stored document', async () => {
    const { bo, collection } = await setup();
    await bo.storage.api.set(BOOKINGS_COLLECTION, 'booking-1', {
      schemaVersion: 1,
      fleetId: 'FLEET-1',
      allocationProcessed: false,
    });
    const doc = await newClient().fetchQuery(
      bookingStateQueryOptions(collection, 'FLEET-1', 'booking-1'),
    );
    expect(doc?.version).toBe(1);
  });

  it('fails with a StorageRequestError', async () => {
    const { bo, collection } = await setup();
    bo.storage.api.get.mockRejectedValueOnce(hostError('rate-limited', 429));
    const failure = newClient().fetchQuery(
      bookingStateQueryOptions(collection, 'FLEET-1', 'booking-1'),
    );
    await expect(failure).rejects.toBeInstanceOf(StorageRequestError);
  });
});

describe('bookingCountQueryOptions', () => {
  it('reads the total of a page of one row', async () => {
    const authFetch = vi.fn<AuthFetch>(async () =>
      jsonResponse([], { headers: { totalelements: '42', totalpages: '42' } }),
    );
    expect(await newClient().fetchQuery(bookingCountQueryOptions(authFetch, 'FLEET-1', 'alert'))).toBe(42);
    expect(String(authFetch.mock.calls[0]?.[0])).toContain('/status/ALERT?page=0&size=1&');
  });

  it('fails with an ApiRequestError', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('', { status: 500 }));
    await expect(
      newClient().fetchQuery(bookingCountQueryOptions(authFetch, 'FLEET-1', 'upcoming')),
    ).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe('confirmedBookingsQueryOptions', () => {
  it('reads the confirmed bookings in one large page, latest first', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse([]));
    const page = await newClient().fetchQuery(confirmedBookingsQueryOptions(authFetch, 'FLEET-1'));
    expect(page.items).toEqual([]);
    const url = String(authFetch.mock.calls[0]?.[0]);
    expect(url).toContain('/status/CONFIRMED?page=0&size=2000&sort=startDate%2CDESC');
  });
});

describe('bookingQueryOptions', () => {
  it('reads one booking, and fails with an ApiRequestError', async () => {
    const ok = vi.fn<AuthFetch>(async () =>
      jsonResponse({ id: 'booking-1', status: 'PENDING', startDate: '2026-03-10T10:00:00Z' }),
    );
    expect((await newClient().fetchQuery(bookingQueryOptions(ok, 'FLEET-1', 'booking-1'))).id).toBe(
      'booking-1',
    );
    const missing = vi.fn<AuthFetch>(async () => new Response('', { status: 404 }));
    await expect(
      newClient().fetchQuery(bookingQueryOptions(missing, 'FLEET-1', 'booking-1')),
    ).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe('vehicle queries', () => {
  it('load the trips, the catalogue and the live state', async () => {
    const authFetch = vi.fn<AuthFetch>(async (path) => {
      const url = String(path);
      if (url.endsWith('/book')) return jsonResponse([{ id: 'vehicle-1', orderId: 'trip-1' }]);
      if (url.startsWith('user/vehicle')) return jsonResponse([{ id: 'vehicle-1', plate: 'AB-123-CD' }]);
      return jsonResponse([{ id: 'vehicle-1', vehicle_status: 0 }]);
    });
    const client = newClient();
    expect(await client.fetchQuery(tripsInProgressQueryOptions(authFetch, 'FLEET-1'))).toEqual([
      { tripId: 'trip-1', vehicleId: 'vehicle-1', plate: null },
    ]);
    const catalog = vehicleCatalogQueryOptions(authFetch, 'FLEET-1');
    expect((await client.fetchQuery(catalog))[0]?.plate).toBe('AB-123-CD');
    expect(catalog.gcTime).toBeGreaterThanOrEqual(PERSIST_MAX_AGE_MS);
    expect((await client.fetchQuery(liveVehiclesQueryOptions(authFetch, 'FLEET-1')))[0]?.status).toBe(
      'AVAILABLE',
    );
  });

  it('fail with an ApiRequestError', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('', { status: 403 }));
    await expect(
      newClient().fetchQuery(liveVehiclesQueryOptions(authFetch, 'FLEET-1')),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(
      newClient().fetchQuery(tripsInProgressQueryOptions(authFetch, 'FLEET-1')),
    ).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe('bookingAddressQueryOptions', () => {
  it('reads an address once, in memory only', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ features: [{ place_name: '1 Example Street', center: [2.35, 48.85] }] }),
    );
    const options = bookingAddressQueryOptions('pk.t', { latitude: 48.85, longitude: 2.35 }, 'en', fetcher);
    const client = newClient();
    expect(await client.fetchQuery(options)).toBe('1 Example Street');
    expect(await client.fetchQuery(options)).toBe('1 Example Street');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(options.gcTime).toBeUndefined();
    expect(isPersistedQueryKey(options.queryKey)).toBe(false);
  });

  it('fails with an ApiRequestError', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 401 }));
    const options = bookingAddressQueryOptions('pk.t', { latitude: 1, longitude: 2 }, 'en', fetcher);
    await expect(newClient().fetchQuery(options)).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe('fleetBookingStatesQueryOptions', () => {
  const setup = async () => {
    const bo = fakeBo();
    const client = await connect({ vulogBo: bo.api });
    disconnects.push(() => client.disconnect());
    return { bo, collection: bookingsCollection(client.storage) };
  };
  const value = { schemaVersion: 1, fleetId: 'FLEET-1', allocationProcessed: false };

  it('lists the documents of the fleet and seeds the state of each booking', async () => {
    const { bo, collection } = await setup();
    await bo.storage.api.set(BOOKINGS_COLLECTION, 'booking-1', value);
    await bo.storage.api.set(BOOKINGS_COLLECTION, 'booking-2', { ...value, fleetId: 'FLEET-2' });
    const client = newClient();

    const listed = await client.fetchQuery(fleetBookingStatesQueryOptions(client, collection, 'FLEET-1'));

    expect(listed.docs.map((doc) => doc.id)).toEqual(['booking-1']);
    expect(client.getQueryData(queryKeys.bookingState('FLEET-1', 'booking-1'))).toMatchObject({
      id: 'booking-1',
      version: 1,
    });
    expect(client.getQueryData(queryKeys.bookingState('FLEET-1', 'booking-2'))).toBeUndefined();
  });

  it('fails with a StorageRequestError', async () => {
    const { bo, collection } = await setup();
    bo.storage.api.query.mockRejectedValueOnce(hostError('rate-limited', 429));
    const client = newClient();
    await expect(
      client.fetchQuery(fleetBookingStatesQueryOptions(client, collection, 'FLEET-1')),
    ).rejects.toBeInstanceOf(StorageRequestError);
  });
});

describe('seedBookingStates', () => {
  const doc = (version: number) => ({
    id: 'booking-1',
    version,
    expiresAt: null,
    value: { schemaVersion: 1 as const, fleetId: 'FLEET-1', allocationProcessed: false },
  });

  it('never replaces a newer version with an older one', () => {
    const client = newClient();
    const key = queryKeys.bookingState('FLEET-1', 'booking-1');
    client.setQueryData(key, doc(3));
    seedBookingStates(client, 'FLEET-1', [doc(2)]);
    expect(client.getQueryData(key)).toEqual(doc(3));
    seedBookingStates(client, 'FLEET-1', [doc(4)]);
    expect(client.getQueryData(key)).toEqual(doc(4));
  });

  it('replaces a cached null', () => {
    const client = newClient();
    const key = queryKeys.bookingState('FLEET-1', 'booking-1');
    client.setQueryData(key, null);
    seedBookingStates(client, 'FLEET-1', [doc(1)]);
    expect(client.getQueryData(key)).toEqual(doc(1));
  });
});
