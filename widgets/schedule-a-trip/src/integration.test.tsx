// Wires the real modules (API wrappers, queries, persistence, storage, grid) together; only the
// edges are faked: the back office API, fetch, the IntersectionObserver and localStorage.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useAuthFetch, useBoClient, useBoContext } from '@vulog/bo-widget-react';
import { connect } from '@vulog/bo-widget-sdk';
import { useMemo, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledBooking } from './api/schedule-a-trip';
import { persistKey } from './query/client';
import {
  bookingPagesQueryOptions,
  bookingStateQueryOptions,
  customersQueryOptions,
  modelsQueryOptions,
} from './query/queries';
import { WidgetQueryProvider } from './query/WidgetQueryProvider';
import { bookingsCollection, BOOKINGS_COLLECTION, claimCharge } from './storage/booking-state';
import { API_BASE_URL, fakeBo, jsonResponse } from './test/fake-bo';
import { activeObservers, installFakeIntersectionObserver } from './test/intersection-observer';
import { renderInWidget } from './test/render';
import { ListGrid, type ListGridColumn } from './ui/ListGrid';
import { SkeletonCell } from './ui/SkeletonCell';

const sort = { field: 'startDate', direction: 'ASC' } as const;

function CustomerCell({
  userId,
  visibleIds,
}: {
  userId: string | null;
  visibleIds: readonly string[];
}) {
  const authFetch = useAuthFetch();
  const { fleetId } = useBoContext();
  const customers = useQuery({
    ...customersQueryOptions(authFetch, fleetId ?? '', visibleIds),
    enabled: visibleIds.length > 0,
  });
  if (customers.isError) return <span>error</span>;
  const customer = customers.data?.find((candidate) => candidate.id === userId);
  return customer ? <span>{`${customer.firstName} ${customer.lastName}`}</span> : <SkeletonCell />;
}

function ModelCell({ modelId }: { modelId: number | null }) {
  const authFetch = useAuthFetch();
  const { fleetId } = useBoContext();
  const models = useQuery(modelsQueryOptions(authFetch, fleetId ?? ''));
  const model = models.data?.find((candidate) => candidate.id === modelId);
  return model ? <span>{model.name}</span> : <SkeletonCell />;
}

function StateCell({ bookingId }: { bookingId: string }) {
  const bo = useBoClient();
  const { fleetId } = useBoContext();
  const collection = useMemo(() => bookingsCollection(bo.storage), [bo]);
  const state = useQuery(bookingStateQueryOptions(collection, fleetId ?? '', bookingId));
  if (state.isPending) return <SkeletonCell />;
  if (state.isError) return <span>error</span>;
  return <span>{state.data?.value.chargeStartedAt ? 'claimed' : 'none'}</span>;
}

function Upcoming() {
  const authFetch = useAuthFetch();
  const { fleetId } = useBoContext();
  const list = useInfiniteQuery(
    bookingPagesQueryOptions(authFetch, {
      fleetId: fleetId ?? '',
      tab: 'upcoming',
      sort,
      pageSize: 2,
    }),
  );
  const [visible, setVisible] = useState<readonly string[]>([]);
  const rows = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data]);
  const visibleUserIds = useMemo(
    () =>
      rows
        .filter((row) => visible.includes(row.id))
        .flatMap((row) => (row.userId ? [row.userId] : [])),
    [rows, visible],
  );
  const columns = useMemo<ListGridColumn<ScheduledBooking>[]>(
    () => [
      { id: 'id', header: 'Booking', width: '120px', render: (row) => row.id },
      {
        id: 'customer',
        header: 'Customer',
        width: '1fr',
        render: (row) => <CustomerCell userId={row.userId} visibleIds={visibleUserIds} />,
      },
      {
        id: 'model',
        header: 'Model',
        width: '1fr',
        render: (row) => <ModelCell modelId={row.modelId} />,
      },
      {
        id: 'state',
        header: 'State',
        width: '1fr',
        render: (row) => <StateCell bookingId={row.id} />,
      },
    ],
    [visibleUserIds],
  );
  return (
    <ListGrid
      label="Upcoming"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      totalCount={list.data?.pages[0]?.totalElements ?? null}
      isLoading={list.isPending}
      pagination={{
        hasNextPage: list.hasNextPage,
        isFetchingNextPage: list.isFetchingNextPage,
        isFetchNextPageError: list.isFetchNextPageError,
        fetchNextPage: () => void list.fetchNextPage(),
      }}
      onVisibleRowsChange={(ids) => setVisible([...ids])}
    />
  );
}

const booking = (id: string, userId: string) => ({
  id,
  status: 'PENDING',
  startDate: '2026-03-10T10:00:00Z',
  userId,
  modelId: 7,
});

/** The fake Vulog API: two pages of bookings, the customers, the models. */
const stubApi = () =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(new URL(API_BASE_URL).pathname, '');
    const headers = { totalelements: '3', totalpages: '2' };
    if (path === 'user/scheduleATrip/fleets/FLEET-1/bookingrequests/status/PENDING') {
      return url.searchParams.get('page') === '0'
        ? jsonResponse([booking('booking-1', 'user-1'), booking('booking-2', 'user-2')], {
            headers,
          })
        : jsonResponse([booking('booking-3', 'user-3')], { headers });
    }
    if (path === 'user/fleets/FLEET-1/users/list' && init?.method === 'POST') {
      const ids = JSON.parse(String(init.body)) as string[];
      return jsonResponse(
        ids.map((id) => ({
          id,
          firstName: 'Jane',
          lastName: `Doe ${id}`,
          birthDate: '1990-01-01T00:00:00Z',
        })),
      );
    }
    if (path === 'user/vehicle/fleets/FLEET-1/vehicles/models')
      return jsonResponse([{ id: 7, name: 'City car' }]);
    return new Response('', { status: 404 });
  });

let unmount: (() => void) | undefined;

beforeEach(() => {
  installFakeIntersectionObserver();
  localStorage.clear();
});
afterEach(() => {
  unmount?.();
  unmount = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const gridObserver = () =>
  activeObservers().find((observer) => observer.options.rootMargin === `${20 * 48}px 0px`);
const endObserver = () =>
  activeObservers().find((observer) => observer.options.rootMargin?.startsWith('0px 0px'));

describe('the booking list foundation', () => {
  it('shows the rows, enriches the visible ones only, pages on scroll and persists no personal data', async () => {
    const fetchMock = stubApi();
    const bo = fakeBo();
    const seeding = await connect({ vulogBo: bo.api });
    await claimCharge(bookingsCollection(seeding.storage), 'booking-2', {
      fleetId: 'FLEET-1',
      userId: 'user-1',
      now: new Date('2026-03-01T10:00:00Z'),
    });
    seeding.disconnect();
    expect(bo.storage.docs(BOOKINGS_COLLECTION).has('booking-2')).toBe(true);

    const view = await renderInWidget(
      <WidgetQueryProvider>
        <Upcoming />
      </WidgetQueryProvider>,
      bo.api,
    );
    unmount = view.unmount;
    const row = (id: string) => view.container.querySelector(`[data-row-id="${id}"]`);

    // The rows show at once, the customers stay skeletons until their row is visible.
    await vi.waitFor(() => expect(row('booking-2')).not.toBeNull());
    await vi.waitFor(() => expect(row('booking-1')?.textContent).toContain('City car'));
    expect(row('booking-1')?.querySelector('[data-skeleton]')).not.toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('users/list'))).toBe(
      false,
    );
    await vi.waitFor(() => expect(row('booking-2')?.textContent).toContain('claimed'));
    expect(row('booking-1')?.textContent).toContain('none');

    // Row 2 becomes visible: only its customer is asked for.
    await vi.waitFor(() => expect(gridObserver()?.targets.size).toBe(2));
    gridObserver()?.report([row('booking-2')!], true);
    await vi.waitFor(() => expect(row('booking-2')?.textContent).toContain('Jane Doe user-2'));
    const usersCall = fetchMock.mock.calls.find(([input]) => String(input).includes('users/list'));
    expect(usersCall?.[1]?.body).toBe('["user-2"]');

    // The end of the list comes near: the second page is loaded.
    endObserver()?.report(endObserver()!.targets, true);
    await vi.waitFor(() => expect(row('booking-3')).not.toBeNull());
    expect(view.container.querySelector('[role="grid"]')?.getAttribute('aria-rowcount')).toBe('4');

    // Only the reference data reaches localStorage.
    await vi.waitFor(
      () => expect(localStorage.getItem(persistKey('FLEET-1'))).toContain('City car'),
      { timeout: 3000 },
    );
    const persisted = localStorage.getItem(persistKey('FLEET-1')) ?? '';
    expect(persisted).not.toContain('Jane');
    expect(persisted).not.toContain('booking-1');
    expect(persisted).not.toContain('claimed');
  });

  it('keeps an API failure in its cell', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('users/list')) return new Response('', { status: 403 });
      if (url.includes('vehicles/models')) return jsonResponse([{ id: 7, name: 'City car' }]);
      return jsonResponse([booking('booking-1', 'user-1')], { headers: { totalpages: '1' } });
    });
    const view = await renderInWidget(
      <WidgetQueryProvider>
        <Upcoming />
      </WidgetQueryProvider>,
    );
    unmount = view.unmount;
    const row = () => view.container.querySelector('[data-row-id="booking-1"]');
    await vi.waitFor(() => expect(gridObserver()?.targets.size).toBe(1));

    gridObserver()?.report([row()!], true);

    await vi.waitFor(() => expect(row()?.textContent).toContain('error'));
    expect(row()?.textContent).toContain('City car');
  });
});
