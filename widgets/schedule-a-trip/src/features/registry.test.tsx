import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../i18n';
import { BOOKINGS_COLLECTION } from '../storage/booking-state';
import { renderInWidget } from '../test/render';
import { booking, context, stateDoc } from '../test/section';
import type { BookingContext, BookingFeature } from './extensions';
import { primaryActionOf } from './list/RowActions';
import { PREPAYMENT_FILTER_IDS } from './prepayment';
import { useBookingFeatures, validateFeatures, type SectionFeature } from './registry';
import { fakeBo } from '../test/fake-bo';
import { createCoreFeature } from './core';

const t = createI18n('en_GB').t;
const deps = {
  t,
  openDetail: vi.fn(),
  copyId: vi.fn(),
  sortHeader: (_field: string, label: string) => label,
  now: () => new Date('2026-03-10T08:00:00Z'),
};
let unmount: (() => void) | undefined;
afterEach(() => unmount?.());

describe('useBookingFeatures', () => {
  it('gives the core and write features first, then the extra ones, and keeps them while nothing changes', async () => {
    const extra: BookingFeature[] = [{ id: 'extra' }];
    const seen: (readonly BookingFeature[])[] = [];
    function Probe({ pass }: { pass: number }) {
      seen.push(useBookingFeatures(deps, extra).features);
      return <p>{pass}</p>;
    }
    const view = await renderInWidget(<Probe pass={1} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toBe('1'));
    // Settled once the settings and the regularizations are read.
    await vi.waitFor(() => expect(primaryActionOf(seen.at(-1) ?? [], context())?.disabledReason).toBeUndefined());
    await new Promise((resolve) => setTimeout(resolve, 20));
    const settled = seen.at(-1);
    view.rerender(<Probe pass={2} />);
    await vi.waitFor(() => expect(view.container.textContent).toBe('2'));
    expect(settled?.map((feature) => feature.id)).toEqual(['core', 'prepayment', 'write', 'extra']);
    expect(seen.at(-1)).toBe(settled);
  });

  it('gives the core, prepayment and write features by default', async () => {
    let ids: string[] = [];
    function Probe() {
      ids = useBookingFeatures(deps).features.map((feature) => feature.id);
      return null;
    }
    const view = await renderInWidget(<Probe />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(ids).toEqual(['core', 'prepayment', 'write']));
  });
});

/** The features of the registry, once the settings and the regularizations are read. */
async function registryFeatures(api: object = fakeBo().api) {
  let features: readonly SectionFeature[] = [];
  function Probe() {
    features = useBookingFeatures(deps).features;
    return null;
  }
  const view = await renderInWidget(<Probe />, api);
  unmount = view.unmount;
  await vi.waitFor(() => {
    expect(primaryActionOf(features, context())?.disabledReason).toBeUndefined();
    expect(features.find((feature) => feature.id === 'prepayment')?.filterSources?.[0]?.bookingIds).toBeDefined();
  });
  return () => features;
}

describe('the registered features', () => {
  const business = { ...context().customer!, profiles: [{ id: 'profile-1', type: 'Business', entityId: 'entity-1' }] };
  const invoice = (invoiceStatus: string, more: Record<string, unknown> = {}) =>
    stateDoc({ chargeStartedAt: '2026-03-01T08:00:00Z', invoiceId: 'invoice-1', invoiceStatus, chargeAmount: 50, ...more });
  const cancelled = (overrides: Partial<BookingContext>) =>
    context({ tab: 'cancelled', booking: booking({ status: 'CANCELLED', cancellationDate: '2026-03-09T08:00:00Z' }), ...overrides });

  it('gives each row the primary action of the first feature that has one', async () => {
    const features = await registryFeatures();
    const primary = (ctx: BookingContext) => primaryActionOf(features(), ctx)?.id ?? null;
    const matrix: [string, BookingContext, string | null][] = [
      ['upcoming, not charged', context(), 'prepayment.charge'],
      ['upcoming, business', context({ customer: business }), 'preallocate'],
      ['upcoming, claim without invoice', context({ state: stateDoc({ chargeStartedAt: '2026-03-01T08:00:00Z' }) }), 'prepayment.verify'],
      ['upcoming, payment pending', context({ state: invoice('PENDING') }), null],
      ['upcoming, payment method missing', context({ state: invoice('MOP_MISSING') }), null],
      ['upcoming, payment refused', context({ state: invoice('REFUSED') }), 'prepayment.retry'],
      ['upcoming, paid', context({ state: invoice('PAID') }), 'preallocate'],
      ['upcoming, paid and pre-allocated', context({ state: invoice('PAID', { preallocatedVehicleId: 'vehicle-1' }) }), null],
      ['upcoming, state loading', context({ state: undefined }), null],
      ['alert, not charged', context({ tab: 'alert' }), 'prepayment.charge'],
      ['alert, paid', context({ tab: 'alert', state: invoice('PAID') }), 'allocate'],
      ['ongoing', context({ tab: 'ongoing', state: invoice('PAID') }), null],
      ['completed', context({ tab: 'completed', state: invoice('PAID') }), null],
      ['cancelled, paid', cancelled({ state: invoice('PAID') }), 'prepayment.refund'],
      [
        'cancelled, refunded with fees to regularize',
        cancelled({
          state: invoice('REFUNDED', {
            refundedAt: '2026-03-09T09:00:00Z',
            toRegularize: { missingAmount: 10, at: '2026-03-09T09:00:00Z' },
            regularizationPending: true,
          }),
        }),
        'prepayment.regularize',
      ],
      ['cancelled, no stored data', cancelled({ state: null }), null],
    ];
    expect(matrix.map(([name, ctx]) => [name, primary(ctx)])).toEqual(matrix.map(([name, , id]) => [name, id]));
    expect(primaryActionOf(features(), context({ customer: undefined }))).toMatchObject({
      id: 'prepayment.charge',
      disabledReason: 'Loading…',
    });
  });

  it('keeps the pre-allocation in the menu until the prepayment is paid, with why', async () => {
    const features = await registryFeatures();
    const preallocate = (ctx: BookingContext) =>
      features()
        .flatMap((feature) => feature.menuActions?.(ctx) ?? [])
        .find((action) => action.id === 'preallocate');
    expect(preallocate(context({ state: invoice('PENDING') }))).toMatchObject({
      disabled: true,
      disabledReason: 'Pre-allocation needs a paid prepayment, or a business booking.',
    });
    expect(preallocate(context({ state: invoice('PAID') }))?.disabled).toBeUndefined();
    const removal = features()
      .flatMap((feature) => feature.menuActions?.(context({ state: invoice('REFUNDED', { preallocatedVehicleId: 'v-1' }) })) ?? [])
      .find((action) => action.id === 'remove-preallocation');
    expect(removal?.disabled).toBeUndefined();
  });

  it('is consistent: cards after those of the section, one host per feature', async () => {
    const features = await registryFeatures();
    expect(validateFeatures(features())).toEqual([]);
    const cards = features().flatMap((feature) => feature.detailCards ?? []);
    for (const card of cards.filter((candidate) => candidate.id.startsWith('prepayment.'))) {
      expect(card.order).toBeGreaterThanOrEqual(40);
    }
    expect(features().filter((feature) => feature.Host).map((feature) => feature.id)).toEqual(['prepayment', 'write']);
  });

  it('gives "To regularize" the bookings the storage lists', async () => {
    const bo = fakeBo();
    await bo.storage.api.set(BOOKINGS_COLLECTION, 'booking-7', {
      schemaVersion: 1,
      fleetId: 'FLEET-1',
      allocationProcessed: false,
      toRegularize: { missingAmount: 10, at: '2026-03-09T09:00:00Z' },
      regularizationPending: true,
    });
    const features = await registryFeatures(bo.api);
    const prepayment = features().find((feature) => feature.id === 'prepayment');
    expect(prepayment?.filterSources).toMatchObject([
      { filterId: PREPAYMENT_FILTER_IDS.toRegularize, bookingIds: ['booking-7'], failure: null },
    ]);
  });

  it('says when the bookings to regularize cannot be listed, and logs it', async () => {
    const bo = fakeBo();
    bo.storage.api.query.mockRejectedValue(Object.assign(new Error('down'), { code: 'unavailable', status: 503 }));
    let features: readonly SectionFeature[] = [];
    function Probe() {
      features = useBookingFeatures(deps).features;
      return null;
    }
    const view = await renderInWidget(<Probe />, bo.api);
    unmount = view.unmount;
    await vi.waitFor(
      () => expect(features.find((feature) => feature.id === 'prepayment')?.filterSources?.[0]?.failure?.error).toBeInstanceOf(Error),
      { timeout: 5000 },
    );
    expect(features.find((feature) => feature.id === 'prepayment')?.filterSources?.[0]?.bookingIds).toBeUndefined();
    expect(bo.api.log.warn).toHaveBeenCalledWith('The bookings to regularize could not be listed', expect.any(Object));
  });
});

describe('validateFeatures', () => {
  const core = createCoreFeature(deps);
  const filter = { id: 'f', label: 'F', tabs: ['upcoming' as const], test: () => true, needsAllPages: false };

  it('accepts the core feature and a consistent feature', () => {
    expect(validateFeatures([core])).toEqual([]);
    expect(
      validateFeatures([core, { id: 'x', filters: [filter], kpis: [{ id: 'k', label: 'K', tab: 'upcoming', filterId: 'f', tone: 'info' }] }]),
    ).toEqual([]);
  });

  it('reports duplicate ids and KPIs on an unknown or foreign filter', () => {
    expect(
      validateFeatures([
        core,
        {
          id: 'core',
          columns: () => [{ id: 'start', header: 'S', width: '1px', render: () => null }],
          filters: [filter, filter],
          kpis: [
            { id: 'k1', label: 'K', tab: 'upcoming', filterId: 'missing', tone: 'info' },
            { id: 'k2', label: 'K', tab: 'alert', filterId: 'f', tone: 'info' },
          ],
          detailCards: [{ id: 'trip', order: 1, render: () => null }],
        },
      ]),
    ).toEqual([
      'Duplicate feature id: core',
      'Duplicate column (alert) id: start',
      'Duplicate column (upcoming) id: start',
      'Duplicate column (ongoing) id: start',
      'Duplicate column (completed) id: start',
      'Duplicate column (cancelled) id: start',
      'Duplicate filter id: f',
      'Duplicate detail card id: trip',
      'KPI k1 names an unknown filter: missing',
      'KPI k2 is on alert, where its filter f does not apply',
    ]);
  });

  it('reports bookings given to a filter the feature does not have', () => {
    expect(
      validateFeatures([core, { id: 'x', filters: [filter], filterSources: [{ filterId: 'f', bookingIds: [] }, { filterId: 'g', bookingIds: undefined }] }]),
    ).toEqual(['Feature x gives bookings to an unknown filter: g']);
  });

  it('logs the broken rules of the registry', async () => {
    const bo = fakeBo();
    const extra: BookingFeature[] = [{ id: 'core' }];
    function Probe() {
      useBookingFeatures(deps, extra);
      return null;
    }
    const view = await renderInWidget(<Probe />, bo.api);
    unmount = view.unmount;
    await vi.waitFor(() =>
      expect(bo.api.log.error).toHaveBeenCalledWith('The booking features break the extension point', {
        problems: ['Duplicate feature id: core'],
      }),
    );
  });
});
