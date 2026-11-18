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
import App from './App';
import { dialogShown } from './test/dom';
import { fakeAima } from './test/fake-aima';
import { API_BASE_URL, fakeBo, jsonResponse, VALID_SETTINGS } from './test/fake-bo';
import { apiBooking, fleetApi, stubVulogApi } from './test/vulog-api';
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

describe('the widget, from the list to the regularization', () => {
  const sectionGridObserver = () =>
    activeObservers().find(
      (observer) => observer.options.rootMargin?.endsWith('px 0px') && !observer.options.rootMargin.startsWith('0px'),
    );
  const rowOf = (root: HTMLElement, id: string) =>
    root.querySelector<HTMLElement>(`[role="row"][data-row-id="${id}"]`);
  const buttonIn = (within: ParentNode, name: string) =>
    [...within.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === name || candidate.getAttribute('aria-label') === name,
    );
  const dialogButton = (name: string) => buttonIn(document.body.querySelector('[role="dialog"]') ?? document.body, name);
  const showRow = async (root: HTMLElement, id: string) => {
    await vi.waitFor(() => expect(rowOf(root, id)).not.toBeNull());
    await vi.waitFor(() => expect(sectionGridObserver()?.targets.size).toBeGreaterThan(0));
    sectionGridObserver()?.report([rowOf(root, id)!], true);
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prepays, pre-allocates once paid, refunds after the cancellation, then regularizes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-10T08:00:00.000Z'));
    const bookings: Record<string, unknown[]> = {
      PENDING: [
        apiBooking({
          id: 'booking-1',
          userId: 'customer-1',
          startDate: '2026-03-12T08:00:00.000Z',
          plannedReturnDate: '2026-03-12T20:00:00.000Z',
        }),
      ],
      CANCELLED: [],
    };
    const aima = fakeAima({ productPrice: 15, wallets: [{ id: 'wallet-1', availableAmount: 5 }] });
    stubVulogApi(
      fleetApi(
        {
          bookings,
          catalog: [{ id: 'near', plate: 'AA-001-AA', model: { id: 7, name: 'City car' }, serviceIds: ['service-1'] }],
          vehicles: [{ id: 'near', vehicle_status: 0, location: { latitude: 48.857, longitude: 2.353 } }],
        },
        async ({ path, query, init }) => {
          if (path === 'user/fleets/FLEET-1/users/list') {
            return jsonResponse([
              {
                id: 'customer-1',
                firstName: 'Jane',
                lastName: 'Doe',
                userName: 'jane.doe',
                profiles: [{ id: 'profile-1', type: 'Single', entity: { id: 'entity-1' } }],
              },
            ]);
          }
          if (path.includes('/billing/') || path.startsWith('user/fleets/FLEET-1/products/')) {
            const search = query.toString();
            return aima.authFetch(search ? `${path}?${search}` : path, init);
          }
          if (path.endsWith('/vehicles/near/disable')) return new Response(null, { status: 200 });
          return undefined;
        },
      ),
    );
    const bo = fakeBo({ getSettings: async () => ({ ...VALID_SETTINGS, currency: 'EUR' }) });
    window.history.replaceState(null, '', '/');
    const view = await renderInWidget(<App />, bo.api);
    unmount = view.unmount;
    const root = view.container;
    const row = () => rowOf(root, 'booking-1');

    // Upcoming: "Prepay" wins over the pre-allocation, which waits for the payment.
    await showRow(root, 'booking-1');
    await vi.waitFor(() => expect(buttonIn(row()!, 'Prepay')?.disabled).toBe(false));
    buttonIn(row()!, 'Prepay')?.click();
    await dialogShown();
    await vi.waitFor(() => expect(dialogButton('Prepay')?.disabled).toBe(false));
    dialogButton('Prepay')?.click();
    await vi.waitFor(() => expect(buttonIn(document.body, 'Charge €50.00')).toBeDefined());
    buttonIn(document.body, 'Charge €50.00')?.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('The prepayment is charged.'));
    buttonIn(document.body, 'Close')?.click();
    await vi.waitFor(() => expect(row()?.textContent).toContain('Payment in progress'));
    expect(buttonIn(row()!, 'Pre-allocate a vehicle')).toBeUndefined();

    // The payment settles in the billing API: the refresh reads it and writes it back.
    aima.invoices.get('invoice-new-1')!.status = 'PAID';
    aima.invoices.get('invoice-new-1')!.refundable = 50;
    buttonIn(root, 'Refresh')?.click();
    await vi.waitFor(() => expect(row()?.textContent).toContain('Paid'));
    await vi.waitFor(() =>
      expect(bo.storage.docs(BOOKINGS_COLLECTION).get('booking-1')?.value.invoiceStatus).toBe('PAID'),
    );

    // Paid: the pre-allocation is the primary action now.
    await vi.waitFor(() => expect(buttonIn(row()!, 'Pre-allocate a vehicle')).toBeDefined());
    buttonIn(row()!, 'Pre-allocate a vehicle')?.click();
    await dialogShown();
    await vi.waitFor(() => expect(dialogButton('Pre-allocate')).toBeDefined());
    dialogButton('Pre-allocate')?.click();
    await vi.waitFor(() => expect(row()?.textContent).toContain('AA-001-AA'));
    expect(bo.storage.docs(BOOKINGS_COLLECTION).get('booking-1')?.value).toMatchObject({
      preallocatedVehicleId: 'near',
      invoiceStatus: 'PAID',
    });

    // The booking is cancelled in the back office; the scheduler had granted the credits.
    vi.setSystemTime(new Date('2026-03-12T07:45:00.000Z'));
    bookings.CANCELLED = [
      { ...(bookings.PENDING?.[0] as object), status: 'CANCELLED', cancellationDate: '2026-03-12T07:30:00.000Z' },
    ];
    bookings.PENDING = [];
    const stored = bo.storage.docs(BOOKINGS_COLLECTION).get('booking-1')!;
    await bo.storage.api.set(BOOKINGS_COLLECTION, 'booking-1', { ...stored.value, creditsAdded: true, walletId: 'wallet-1' });
    buttonIn(root, 'Refresh')?.click();
    await vi.waitFor(() => expect(root.querySelector('[role="tab"][aria-selected="true"]')).not.toBeNull());
    [...root.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.textContent?.startsWith('Cancelled'))?.click();

    // Cancelled: refund, with fees the credits left do not cover.
    await showRow(root, 'booking-1');
    await vi.waitFor(() => expect(buttonIn(row()!, 'Refund')).toBeDefined());
    buttonIn(row()!, 'Refund')?.click();
    await dialogShown();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Fees not covered by the credits left: €10.00'));
    dialogButton('Refund')?.click();
    await vi.waitFor(() => expect(buttonIn(document.body, 'Confirm the refund')).toBeDefined());
    buttonIn(document.body, 'Confirm the refund')?.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('€10.00 to regularize'));
    buttonIn(document.body, 'Close')?.click();
    expect(aima.callsTo('POST', '/refund')).toHaveLength(1);

    // "To regularize" comes from the storage: its KPI counts the booking, its filter lists it.
    await vi.waitFor(() => expect(buttonIn(root, '1To regularize')).toBeDefined());
    buttonIn(root, '1To regularize')?.click();
    await vi.waitFor(() => expect(row()?.textContent).toContain('To regularize (€10.00)'));

    await vi.waitFor(() => expect(buttonIn(row()!, 'Mark as regularized')).toBeDefined());
    buttonIn(row()!, 'Mark as regularized')?.click();
    await dialogShown();
    await vi.waitFor(() => expect(dialogButton('Mark as regularized')).toBeDefined());
    dialogButton('Mark as regularized')?.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Marked as regularized.'));
    buttonIn(document.body, 'Close')?.click();

    await vi.waitFor(() => expect(row()).toBeNull());
    await vi.waitFor(() => expect(buttonIn(root, '0To regularize')).toBeDefined());
    expect(bo.storage.docs(BOOKINGS_COLLECTION).get('booking-1')?.value).toMatchObject({
      regularizationPending: false,
      regularizedBy: 'user-1',
    });
  }, 30_000);
});
