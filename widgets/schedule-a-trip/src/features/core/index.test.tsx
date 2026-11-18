import { describe, expect, it, vi } from 'vitest';
import { createI18n } from '../../i18n';
import { booking, context, stateDoc } from '../../test/section';
import { createCoreFeature, hasNoVehicle, HIDDEN_CORE_COLUMNS } from '.';

const deps = (now = new Date('2026-03-10T08:00:00Z')) => ({
  t: createI18n('en_GB').t,
  openDetail: vi.fn(),
  copyId: vi.fn(),
  sortHeader: (field: string, label: string) => `${label}:${field}`,
  now: () => now,
});

describe('createCoreFeature', () => {
  it('gives the columns of each tab, the cancellation date in Cancelled only', () => {
    const feature = createCoreFeature(deps());
    const ids = (tab: Parameters<NonNullable<typeof feature.columns>>[0]) =>
      feature.columns?.(tab).map((column) => column.id);
    expect(ids('upcoming')).toEqual([
      'id', 'start', 'plannedReturn', 'customer', 'model', 'vehicle', 'radius', 'coordinates', 'failureReason', 'created',
    ]);
    expect(ids('cancelled')).toContain('cancelled');
    expect(ids('ongoing')).not.toContain('failureReason');
    expect(feature.columns?.('upcoming')[1]?.header).toBe('Start:startDate');
    for (const id of HIDDEN_CORE_COLUMNS) expect(ids('upcoming')).toContain(id);
  });

  it('hides the id, the dates of creation, the radius, the coordinates and the alert reason by default', () => {
    const columns = createCoreFeature(deps()).columns?.('upcoming') ?? [];
    expect(columns.filter((column) => column.hiddenByDefault).map((column) => column.id)).toEqual([
      'id', 'radius', 'coordinates', 'failureReason', 'created',
    ]);
    expect(columns.find((column) => column.id === 'plannedReturn')?.hiddenByDefault).toBeUndefined();
  });

  it('renders the plain columns', () => {
    const columns = createCoreFeature(deps()).columns?.('upcoming') ?? [];
    const render = (id: string, ctx = context()) => columns.find((column) => column.id === id)?.render(ctx);
    expect(render('radius')).toBe('500 m');
    expect(render('coordinates')).toBe('48.85660, 2.35220');
    expect(render('radius', context({ booking: booking({ radius: null }) }))).toBe('');
    expect(render('coordinates', context({ booking: booking({ latitude: null }) }))).toBe('');
  });

  it('opens and copies a booking from its menu', () => {
    const d = deps();
    const actions = createCoreFeature(d).menuActions?.(context()) ?? [];
    actions.forEach((action) => action.run(context()));
    expect(actions.map((action) => action.id)).toEqual(['open', 'copy-id']);
    expect(d.openDetail).toHaveBeenCalledWith('booking-1');
    expect(d.copyId).toHaveBeenCalledWith('booking-1');
  });

  it('filters the bookings without vehicle, soon, and without return date', () => {
    const filters = createCoreFeature(deps()).filters ?? [];
    const test = (id: string, ctx = context()) => filters.find((filter) => filter.id === id)?.test(ctx);
    expect(filters.every((filter) => filter.needsAllPages)).toBe(true);
    expect(test('no-vehicle')).toBe(true);
    expect(test('no-vehicle-soon')).toBe(true);
    expect(test('no-vehicle-soon', context({ booking: booking({ startDate: '2026-03-12T08:00:00Z' }) }))).toBe(false);
    expect(test('no-return-date')).toBe(false);
    expect(test('no-return-date', context({ booking: booking({ plannedReturnDate: null }) }))).toBe(true);
  });

  it('gives a KPI on a filter of its own, and the three cards in order', () => {
    const feature = createCoreFeature(deps());
    const filterIds = feature.filters?.map((filter) => filter.id);
    expect(feature.kpis?.every((kpi) => filterIds?.includes(kpi.filterId))).toBe(true);
    expect(feature.detailCards?.map((card) => [card.id, card.order])).toEqual([
      ['trip', 10],
      ['vehicle', 20],
      ['customer', 30],
    ]);
  });
});

describe('hasNoVehicle', () => {
  it('is false with an allocated or a pre-allocated vehicle', () => {
    expect(hasNoVehicle(context())).toBe(true);
    expect(hasNoVehicle(context({ booking: booking({ vehicleId: 'v' }) }))).toBe(false);
    expect(hasNoVehicle(context({ state: stateDoc({ preallocatedVehicleId: 'v' }) }))).toBe(false);
  });
});
