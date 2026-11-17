import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query';
import { connect, type AuthFetch } from '@vulog/bo-widget-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/http';
import {
  bookingsCollection,
  BOOKINGS_COLLECTION,
  StorageRequestError,
} from '../storage/booking-state';
import { fakeBo, hostError, jsonResponse } from '../test/fake-bo';
import { PERSIST_MAX_AGE_MS } from './client';
import { queryKeys } from './keys';
import {
  BOOKING_PAGE_SIZE,
  bookingPagesQueryOptions,
  bookingStateQueryOptions,
  customersQueryOptions,
  invoiceQueryOptions,
  invoiceStaleTime,
  modelsQueryOptions,
} from './queries';

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const sort = { field: 'startDate', direction: 'ASC' } as const;

afterEach(() => vi.restoreAllMocks());

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
  it('loads the invoice', async () => {
    const authFetch = vi.fn<AuthFetch>(async () =>
      jsonResponse({ id: 'invoice-1', invoicesStatus: 'PAID', amount: 20 }),
    );
    const invoice = await newClient().fetchQuery(
      invoiceQueryOptions(authFetch, 'FLEET-1', 'invoice-1'),
    );
    expect(invoice.status).toBe('PAID');
  });

  it('fails with an ApiRequestError', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('', { status: 404 }));
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
