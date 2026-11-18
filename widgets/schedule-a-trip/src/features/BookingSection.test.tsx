// Wires the real section (features, queries, API wrappers, storage, grid, drawer) together; only
// the edges are faked: the back office API, fetch and the IntersectionObserver.
import { connect } from '@vulog/bo-widget-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookingsCollection, createBookingState } from '../storage/booking-state';
import { fakeBo, hostError } from '../test/fake-bo';
import { activeObservers, installFakeIntersectionObserver } from '../test/intersection-observer';
import { renderInWidget } from '../test/render';
import { apiBooking, calledPaths, fleetApi, stubVulogApi } from '../test/vulog-api';
import { BookingSection } from './BookingSection';
import { preloadDetail } from './detail/BookingDrawer';
import { preloadPrepaymentDialogs } from './prepayment';
import type { BookingContext, BookingFeature } from './extensions';
import type { SectionFeature } from './registry';

// The real preloads, observed: the section asks for the chunks of the drawer and the dialogs.
vi.mock('./detail/BookingDrawer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./detail/BookingDrawer')>();
  return { ...actual, preloadDetail: vi.fn(actual.preloadDetail) };
});
vi.mock('./prepayment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./prepayment')>();
  return { ...actual, preloadPrepaymentDialogs: vi.fn(actual.preloadPrepaymentDialogs) };
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

/** A fake BO whose `navigate` pushes `routeChanged`, as the back office does. */
function routedBo(initialPath = '/') {
  window.history.replaceState(null, '', initialPath);
  const bo = fakeBo({
    getContext: async () => ({ fleetId: 'FLEET-1', locale: 'en_GB', basename: '/', timezone: 'UTC' }),
  });
  const navigate = vi.fn(async ({ path }: { path: string }) => {
    const resolved = new URL(path, 'https://bo.example.com/').pathname;
    queueMicrotask(() => bo.emit('routeChanged', { pathname: resolved, search: '', hash: '' }));
    return { path: resolved };
  });
  Object.assign(bo.api, { navigate });
  return { ...bo, navigate };
}

const gridObserver = () =>
  activeObservers().find((observer) => observer.options.rootMargin?.endsWith('px 0px') && !observer.options.rootMargin.startsWith('0px'));

async function render(api: object, extraFeatures?: readonly BookingFeature[]) {
  const view = await renderInWidget(<BookingSection extraFeatures={extraFeatures} />, api);
  unmount = view.unmount;
  const root = view.container;
  return {
    ...view,
    row: (id: string) => root.querySelector<HTMLElement>(`[role="row"][data-row-id="${id}"]`),
    drawer: () => document.body.querySelector<HTMLElement>('[role="dialog"][aria-label="Booking details"]'),
    button: (name: string, within: ParentNode = document.body) =>
      [...within.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent === name || button.getAttribute('aria-label') === name,
      ),
    tab: (name: string) =>
      [...root.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) =>
        tab.textContent?.startsWith(name),
      ),
  };
}

const upcoming = [
  apiBooking({ id: 'booking-1', userId: 'user-1', startDate: '2026-03-10T10:00:00Z' }),
  apiBooking({
    id: 'booking-2',
    userId: 'user-2',
    profileId: 'profile-2',
    plannedReturnDate: null,
    startDate: '2026-03-11T10:00:00Z',
  }),
];

describe('the booking section', () => {
  it('preloads the drawer on a row hovered or focused, and the likely chunks when idle', async () => {
    let idle: (() => void) | undefined;
    vi.stubGlobal('requestIdleCallback', (task: () => void) => {
      idle = task;
      return 1;
    });
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    vi.mocked(preloadDetail).mockClear();
    vi.mocked(preloadPrepaymentDialogs).mockClear();
    stubVulogApi(fleetApi({ bookings: { PENDING: upcoming } }));
    const view = await render(routedBo().api);
    await vi.waitFor(() => expect(view.row('booking-1')).not.toBeNull());
    expect(preloadDetail).not.toHaveBeenCalled();

    view.row('booking-1')?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    expect(preloadDetail).toHaveBeenCalledTimes(1);
    view.row('booking-1')?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(preloadDetail).toHaveBeenCalledTimes(2);
    expect(vi.mocked(preloadDetail).mock.calls[0]?.[0].map((feature) => feature.id)).toEqual(['core', 'prepayment', 'write']);

    idle?.();
    expect(preloadDetail).toHaveBeenCalledTimes(3);
    expect(preloadPrepaymentDialogs).toHaveBeenCalledTimes(1);
  });

  it('lists a tab, enriches the visible rows only, and shows the pre-allocation kept in storage', async () => {
    const fetch = stubVulogApi(
      fleetApi({
        bookings: { PENDING: upcoming, ALERT: [apiBooking({ id: 'alert-1', status: 'ALERT' })] },
        catalog: [{ id: 'vehicle-1', plate: 'AB-123-CD', model: { id: 7, name: 'City car' } }],
      }),
    );
    const bo = routedBo();
    const seeding = await connect({ vulogBo: bo.api });
    await createBookingState(bookingsCollection(seeding.storage), 'booking-2', {
      fleetId: 'FLEET-1',
      patch: { preallocatedVehicleId: 'vehicle-1', preallocatedPlate: 'AB-123-CD' },
    });
    seeding.disconnect();

    const view = await render(bo.api);

    await vi.waitFor(() => expect(view.row('booking-2')?.textContent).toContain('AB-123-CD'));
    // The vehicle model comes from the catalog query, which may resolve after the storage documents.
    await vi.waitFor(() => expect(view.row('booking-1')?.textContent).toContain('City car'));
    expect(view.row('booking-2')?.textContent).toContain('No return date');
    expect(view.row('booking-1')?.querySelector('[data-skeleton]')).not.toBeNull();
    expect(calledPaths(fetch).some((path) => path.includes('users/list'))).toBe(false);
    await vi.waitFor(() => expect(view.tab('Alert')?.textContent).toBe('Alert1'));

    await vi.waitFor(() => expect(gridObserver()?.targets.size).toBe(2));
    gridObserver()?.report([view.row('booking-2')!], true);

    await vi.waitFor(() => expect(view.row('booking-2')?.textContent).toContain('Jane Doe'));
    expect(view.row('booking-2')?.textContent).toContain('B2B');
    const usersCall = fetch.mock.calls.find(([input]) => String(input).includes('users/list'));
    expect(usersCall?.[1]?.body).toBe('["user-2"]');
    expect(view.row('booking-1')?.textContent).not.toContain('Jane');
  });

  it('opens the detail of a row in the URL, moves with the arrows and closes', async () => {
    stubVulogApi(fleetApi({ bookings: { PENDING: upcoming } }));
    const bo = routedBo();
    const view = await render(bo.api);
    await vi.waitFor(() => expect(view.row('booking-1')).not.toBeNull());

    view.row('booking-1')?.click();

    await vi.waitFor(() => expect(view.drawer()).not.toBeNull());
    expect(bo.navigate).toHaveBeenLastCalledWith({ path: 'booking-1' });
    const drawer = view.drawer()!;
    await vi.waitFor(() => expect(drawer.textContent).toContain('Jane Doe'));
    expect(drawer.textContent).toContain('#booking-1');
    // The cards are a lazy chunk: they may render after the header.
    await vi.waitFor(() =>
      expect([...drawer.querySelectorAll('section[aria-label]')].map((card) => card.getAttribute('aria-label'))).toEqual([
        'Actions',
        'Trip',
        'Vehicle',
        'Customer',
        'Payment',
        'Internal notes',
        'Journal',
      ]),
    );
    expect(drawer.querySelector('[data-step="prepaid"]')?.getAttribute('data-state')).toBe('current');
    expect(drawer.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toContain('500 m');
    expect(view.row('booking-1')?.getAttribute('aria-selected')).toBe('true');

    view.button('Next booking')?.click();
    await vi.waitFor(() => expect(view.drawer()?.textContent).toContain('#booking-2'));
    expect(bo.navigate).toHaveBeenLastCalledWith({ path: 'booking-2' });
    expect(view.button('Next booking')?.disabled).toBe(true);

    view.button('Close')?.click();
    await vi.waitFor(() => expect(bo.navigate).toHaveBeenLastCalledWith({ path: '.' }));
    await vi.waitFor(() => expect(view.drawer()).toBeNull());
  });

  it('opens a deep link to a booking that is not in the tab', async () => {
    stubVulogApi(
      fleetApi({
        bookings: {
          PENDING: upcoming,
          CANCELLED: [
            apiBooking({ id: 'gone-1', status: 'CANCELLED', cancellationDate: '2026-03-09T10:00:00Z' }),
          ],
        },
      }),
    );
    const bo = routedBo('/gone-1');
    const view = await render(bo.api);

    await vi.waitFor(() => expect(view.drawer()?.textContent).toContain('#gone-1'));
    const drawer = view.drawer()!;
    expect(drawer.textContent).toContain('Cancelled');
    expect(drawer.querySelector('[data-step="cancelled"]')?.getAttribute('data-state')).toBe('failed');
    await vi.waitFor(() => expect(drawer.textContent).toContain('Jane Doe'));
  });

  it('says when a deep link points to an unknown booking', async () => {
    stubVulogApi(fleetApi({ bookings: { PENDING: upcoming } }));
    const view = await render(routedBo('/unknown-1').api);
    await vi.waitFor(() => expect(view.drawer()).toBeNull());
    await vi.waitFor(() =>
      expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('Not found.'),
    );
  });

  it('splits the confirmed bookings between Ongoing and Completed with the trips in progress', async () => {
    const confirmed = [
      apiBooking({ id: 'ongoing-1', status: 'CONFIRMED', journeyId: 'trip-1', vehicleId: 'vehicle-1' }),
      apiBooking({ id: 'done-1', status: 'CONFIRMED', journeyId: 'trip-2', completed: true }),
      apiBooking({ id: 'odd-1', status: 'CONFIRMED', journeyId: 'trip-3' }),
    ];
    stubVulogApi(
      fleetApi({
        bookings: { CONFIRMED: confirmed },
        trips: [{ id: 'vehicle-1', orderId: 'trip-1' }],
      }),
    );
    const view = await render(routedBo().api);
    await vi.waitFor(() => expect(view.tab('Ongoing')).toBeDefined());

    view.tab('Ongoing')?.click();
    await vi.waitFor(() => expect(view.row('ongoing-1')).not.toBeNull());
    expect(view.row('done-1')).toBeNull();
    expect(view.row('odd-1')).toBeNull();
    await vi.waitFor(() => expect(view.tab('Ongoing')?.textContent).toBe('Ongoing1'));

    view.tab('Completed')?.click();
    await vi.waitFor(() => expect(view.row('done-1')).not.toBeNull());
    expect(view.row('ongoing-1')).toBeNull();
  });

  it('shows an error when the trips in progress cannot be read, not an empty tab', async () => {
    stubVulogApi(
      fleetApi({ bookings: { CONFIRMED: [] } }, ({ path }) =>
        path.endsWith('/book') ? new Response('', { status: 403 }) : undefined,
      ),
    );
    const view = await render(routedBo().api);
    await vi.waitFor(() => expect(view.tab('Completed')).toBeDefined());
    view.tab('Completed')?.click();
    await vi.waitFor(() =>
      expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('not allowed'),
    );
  });

  it('loads every page for a filter, with the progress, then filters', async () => {
    const pageOne = [apiBooking({ id: 'booking-1', vehicleId: 'vehicle-1' })];
    const pageTwo = [apiBooking({ id: 'booking-2', userId: 'user-2' })];
    let release: () => void = () => undefined;
    const secondPage = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubVulogApi(
      fleetApi({}, async ({ path, query }) => {
        if (!path.endsWith('/status/PENDING') || query.get('size') === '1') return undefined;
        const headers = { totalelements: '2', totalpages: '2' };
        if (query.get('page') === '0') return Response.json(pageOne, { headers });
        await secondPage;
        return Response.json(pageTwo, { headers });
      }),
    );
    const view = await render(routedBo().api);
    await vi.waitFor(() => expect(view.row('booking-1')).not.toBeNull());

    [...view.container.querySelectorAll<HTMLElement>('.MuiChip-root')]
      .find((chip) => chip.textContent === 'No vehicle')
      ?.click();

    await vi.waitFor(() =>
      expect(view.container.querySelector('[role="status"]')?.textContent).toContain('1/2'),
    );
    release();
    await vi.waitFor(() => expect(view.row('booking-2')).not.toBeNull());
    expect(view.row('booking-1')).toBeNull();
    expect(view.container.querySelector('[role="status"]')).toBeNull();
  });

  it('searches by customer name, loading the customers of every row', async () => {
    stubVulogApi(
      fleetApi({ bookings: { PENDING: upcoming } }, ({ path, init }) => {
        if (!path.endsWith('users/list') || !init) return undefined;
        const ids = JSON.parse(String(init.body)) as string[];
        return Response.json(
          ids.map((id) => ({ id, firstName: id === 'user-2' ? 'Ada' : 'Jane', lastName: 'Doe' })),
        );
      }),
    );
    const view = await render(routedBo().api);
    await vi.waitFor(() => expect(view.row('booking-2')).not.toBeNull());
    const search = view.container.querySelector<HTMLInputElement>('input[type="search"]')!;

    search.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(search, 'ada');
    search.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => expect(view.row('booking-1')).toBeNull());
    await vi.waitFor(() => expect(view.row('booking-2')?.textContent).toContain('Ada Doe'));
  });

  it('shows a failure of the list with a retry', async () => {
    let fail = true;
    stubVulogApi(
      fleetApi({ bookings: { PENDING: upcoming } }, ({ path }) =>
        fail && path.endsWith('/status/PENDING') ? new Response('', { status: 403 }) : undefined,
      ),
    );
    const view = await render(routedBo().api);
    await vi.waitFor(() =>
      expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
        'You are not allowed',
      ),
    );
    fail = false;
    view.button('Retry', view.container)?.click();
    await vi.waitFor(() => expect(view.row('booking-1')).not.toBeNull());
  });

  it('moves between the rows with the keyboard and opens one with Enter', async () => {
    stubVulogApi(fleetApi({ bookings: { PENDING: upcoming } }));
    const bo = routedBo();
    const view = await render(bo.api);
    await vi.waitFor(() => expect(view.row('booking-2')).not.toBeNull());
    const first = view.row('booking-1')!;
    expect(first.tabIndex).toBe(0);
    expect(view.row('booking-2')?.tabIndex).toBe(-1);

    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(view.row('booking-2'));
    view.row('booking-2')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.waitFor(() => expect(bo.navigate).toHaveBeenLastCalledWith({ path: 'booking-2' }));
  });

  it('plugs a feature in every slot: column, actions, filter, KPI, card and host', async () => {
    // Allocated bookings: the write feature gives them no primary action.
    const allocated = upcoming.map((item) => ({ ...item, vehicleId: 'vehicle-1' }));
    const third = apiBooking({ id: 'booking-3', userId: 'user-3', vehicleId: 'vehicle-1' });
    stubVulogApi(
      fleetApi({ bookings: { PENDING: [...allocated, third] } }, ({ path, query }) =>
        path.endsWith('/status/PENDING') && query.get('size') !== '1'
          ? Response.json(
              query.get('page') === '0' ? allocated : [third],
              { headers: { totalelements: '3', totalpages: '2' } },
            )
          : undefined,
      ),
    );
    const ran: string[] = [];
    const flagged = (ctx: BookingContext) => ctx.booking.id !== 'booking-1';
    const feature: BookingFeature = {
      id: 'test',
      columns: (tab) => [
        { id: 'test-column', header: 'Test column', width: '100px', render: (ctx) => `col-${ctx.booking.id}-${tab}` },
      ],
      primaryAction: (ctx) =>
        flagged(ctx) ? { id: 'do', label: 'Do it', run: (target) => ran.push(target.booking.id) } : null,
      menuActions: () => [{ id: 'extra', label: 'Extra action', run: (target) => ran.push(`extra-${target.booking.id}`) }],
      filters: [{ id: 'flagged', label: 'Flagged', tabs: ['upcoming'], test: flagged, needsAllPages: true }],
      kpis: [{ id: 'flagged', label: 'Flagged bookings', tab: 'upcoming', filterId: 'flagged', tone: 'err' }],
      detailCards: [{ id: 'test-card', order: 15, render: (ctx) => <p data-test-card="">card-{ctx.booking.id}</p> }],
      Host: () => <p data-test-host="">host</p>,
    };
    const features = [feature];
    const view = await render(routedBo().api, features);

    await vi.waitFor(() => expect(view.row('booking-2')?.textContent).toContain('col-booking-2-upcoming'));
    expect(view.container.querySelector('[data-test-host]')).not.toBeNull();
    // booking-2 is a business booking (no prepayment): the action of the feature is its primary one.
    await vi.waitFor(() => expect(gridObserver()?.targets.size).toBeGreaterThan(0));
    gridObserver()?.report([view.row('booking-1')!, view.row('booking-2')!], true);
    await vi.waitFor(() => expect(view.button('Do it', view.row('booking-2')!)).toBeDefined());
    view.button('Do it', view.row('booking-2')!)?.click();
    expect(ran).toEqual(['booking-2']);
    expect(view.button('Do it', view.row('booking-1')!)).toBeUndefined();

    view.button('More actions', view.row('booking-1')!)?.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Extra action'));
    [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent === 'Extra action')
      ?.click();
    expect(ran).toEqual(['booking-2', 'extra-booking-1']);

    // The KPI turns on its filter, which loads every page; its count shows once all are there.
    view.button('Flagged bookings')?.click();
    await vi.waitFor(() => expect(view.row('booking-3')).not.toBeNull());
    expect(view.row('booking-1')).toBeNull();
    await vi.waitFor(() => expect(view.button('2Flagged bookings')).toBeDefined());

    view.row('booking-3')?.click();
    await vi.waitFor(() => expect(view.drawer()?.querySelector('[data-test-card]')?.textContent).toBe('card-booking-3'));
    const cards = [...view.drawer()!.querySelectorAll('section[aria-label], [data-test-card]')];
    expect(cards.map((card) => card.getAttribute('aria-label') ?? 'test')).toEqual([
      'Actions',
      'Trip',
      'test',
      'Vehicle',
      'Customer',
      'Payment',
      'Internal notes',
      'Journal',
    ]);
  });

  it('says when the back office gives no fleet, and calls nothing', async () => {
    const fetch = stubVulogApi(fleetApi({}));
    const bo = fakeBo({ getContext: async () => ({ fleetId: null, locale: 'en_GB', basename: '/' }) });
    const view = await render(bo.api);
    await vi.waitFor(() =>
      expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('no fleet'),
    );
    expect(calledPaths(fetch).some((path) => path.includes('bookingrequests'))).toBe(false);
  });

  it('warns when Ongoing cannot read every confirmed booking at once', async () => {
    stubVulogApi(
      fleetApi({}, ({ path }) =>
        path.endsWith('/status/CONFIRMED')
          ? Response.json([], { headers: { totalelements: '2500', totalpages: '2' } })
          : undefined,
      ),
    );
    const view = await render(routedBo().api);
    await vi.waitFor(() => expect(view.tab('Ongoing')).toBeDefined());
    view.tab('Ongoing')?.click();
    await vi.waitFor(() => expect(view.container.textContent).toContain('some ongoing bookings may be missing'));
  });

  it('refreshes the bookings, the counts, the trips and the stored states', async () => {
    const fetch = stubVulogApi(fleetApi({ bookings: { PENDING: upcoming } }));
    const bo = routedBo();
    const view = await render(bo.api);
    await vi.waitFor(() => expect(view.row('booking-1')).not.toBeNull());
    // The listing of the stored states, and the bookings to regularize.
    await vi.waitFor(() => expect(bo.storage.api.query).toHaveBeenCalledTimes(2));
    const before = calledPaths(fetch).length;

    view.button('Refresh', view.container)?.click();

    await vi.waitFor(() => expect(bo.storage.api.query).toHaveBeenCalledTimes(4));
    await vi.waitFor(() => {
      const after = calledPaths(fetch).slice(before);
      expect(after.some((path) => path.includes('status/PENDING?page=0&size=50'))).toBe(true);
      expect(after.some((path) => path.includes('status/ALERT?page=0&size=1'))).toBe(true);
    });
  });

  it('counts the bookings to regularize from the storage, and says when they cannot be found', async () => {
    const cancelledBooking = apiBooking({ id: 'booking-9', status: 'CANCELLED', cancellationDate: '2026-03-09T08:00:00Z' });
    stubVulogApi(fleetApi({ bookings: { CANCELLED: [cancelledBooking] } }));
    const bo = routedBo();
    await bo.storage.api.set('bookings', 'booking-9', {
      schemaVersion: 1,
      fleetId: 'FLEET-1',
      allocationProcessed: false,
      toRegularize: { missingAmount: 10, at: '2026-03-09T09:00:00Z' },
      regularizationPending: true,
    });
    const view = await render(bo.api);
    await vi.waitFor(() => expect(view.tab('Cancelled')).toBeDefined());
    view.tab('Cancelled')?.click();
    // Counted from the storage, though the pages of Cancelled are not all read.
    await vi.waitFor(() => expect(view.button('1To regularize')).toBeDefined());

    bo.storage.api.query.mockImplementation(async (_name: string, options: { where: Record<string, unknown> }) => {
      if (options.where.regularizationPending) throw hostError('unavailable', 503);
      return { items: [], nextCursor: null };
    });
    view.button('Refresh', view.container)?.click();
    view.button('1To regularize')?.click();
    await vi.waitFor(
      () => expect(view.container.textContent).toContain('The bookings of this filter could not be found'),
      { timeout: 5000 },
    );

    // The storage answers again: the retry lists the bookings and the warning goes.
    bo.storage.api.query.mockReset();
    bo.storage.api.query.mockImplementation(async () => ({ items: [], nextCursor: null }));
    view.button('Retry', view.container)?.click();
    await vi.waitFor(() =>
      expect(view.container.textContent).not.toContain('The bookings of this filter could not be found'),
    );
  });

  it('shows no KPI count while the stored states cannot be read', async () => {
    stubVulogApi(fleetApi({ bookings: { PENDING: upcoming } }));
    const bo = routedBo();
    bo.storage.api.query.mockRejectedValue(hostError('rate-limited', 429));
    const view = await render(bo.api);
    await vi.waitFor(() => expect(view.container.textContent).toContain('could not be loaded: pre-allocations'));
    const kpi = view.container.querySelector('[role="group"] button');
    expect(kpi?.textContent).toBe('No vehicle < 24 h');
  });

  it('keeps the retry of a failed page while every page loads for a filter', async () => {
    let failSecond = true;
    stubVulogApi(
      fleetApi({}, ({ path, query }) => {
        if (!path.endsWith('/status/PENDING') || query.get('size') === '1') return undefined;
        const headers = { totalelements: '2', totalpages: '2' };
        if (query.get('page') === '0') return Response.json([apiBooking({ id: 'booking-1' })], { headers });
        if (failSecond) return new Response('', { status: 503 });
        return Response.json([apiBooking({ id: 'booking-2' })], { headers });
      }),
    );
    const view = await render(routedBo().api);
    await vi.waitFor(() => expect(view.row('booking-1')).not.toBeNull());
    [...view.container.querySelectorAll<HTMLElement>('.MuiChip-root')]
      .find((chip) => chip.textContent === 'No return date')
      ?.click();
    await vi.waitFor(() => expect(view.container.textContent).toContain('The next rows could not be loaded.'), {
      timeout: 5000,
    });
    failSecond = false;
    view.button('Retry', view.container)?.click();
    await vi.waitFor(() => expect(view.container.textContent).not.toContain('The next rows could not be loaded.'));
  });

  it('copies a booking id and says so, or says it could not', async () => {
    stubVulogApi(fleetApi({ bookings: { PENDING: upcoming } }));
    const bo = routedBo();
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const view = await render(bo.api);
    await vi.waitFor(() => expect(view.row('booking-1')).not.toBeNull());
    const copy = async () => {
      view.button('More actions', view.row('booking-1')!)?.click();
      await vi.waitFor(() => expect(document.body.textContent).toContain('Copy the booking id'));
      [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((item) => item.textContent === 'Copy the booking id')
        ?.click();
    };
    await copy();
    await vi.waitFor(() =>
      expect(bo.api.notify).toHaveBeenCalledWith({ message: 'Booking id copied.', severity: 'success' }),
    );
    expect(writeText).toHaveBeenCalledWith('booking-1');
    writeText.mockRejectedValueOnce(new Error('denied'));
    await copy();
    await vi.waitFor(() =>
      expect(bo.api.notify).toHaveBeenCalledWith({
        message: 'The booking id could not be copied.',
        severity: 'error',
      }),
    );
  });

  it('adds the bookings a filter finds by itself while it is active', async () => {
    stubVulogApi(
      fleetApi({
        bookings: {
          CANCELLED: [
            apiBooking({ id: 'listed', status: 'CANCELLED' }),
            apiBooking({ id: 'far-away', status: 'CANCELLED', userId: 'user-2' }),
          ],
        },
      }, ({ path, query }) =>
        // The pages of the tab hold the first booking only.
        path.endsWith('/status/CANCELLED') && query.get('size') !== '1'
          ? Response.json([apiBooking({ id: 'listed', status: 'CANCELLED' })], { headers: { totalpages: '1' } })
          : undefined,
      ),
    );
    const feature: SectionFeature = {
      id: 'sourced',
      filters: [{ id: 'pending', label: 'Pending', tabs: ['cancelled'], test: (ctx) => ctx.booking.id === 'far-away', needsAllPages: false }],
      filterSources: [{ filterId: 'pending', bookingIds: ['far-away'] }],
    };
    const view = await render(routedBo().api, [feature]);
    await vi.waitFor(() => expect(view.tab('Cancelled')).toBeDefined());
    view.tab('Cancelled')?.click();
    await vi.waitFor(() => expect(view.row('listed')).not.toBeNull());
    expect(view.row('far-away')).toBeNull();

    [...view.container.querySelectorAll<HTMLElement>('.MuiChip-root')].find((chip) => chip.textContent === 'Pending')?.click();

    await vi.waitFor(() => expect(view.row('far-away')).not.toBeNull());
    expect(view.row('listed')).toBeNull();
  });
});
