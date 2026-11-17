import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../i18n';
import { renderInWidget } from '../test/render';
import type { BookingFeature } from './extensions';
import { useBookingFeatures, validateFeatures } from './registry';
import { fakeBo } from '../test/fake-bo';
import { createCoreFeature } from './core';

const t = createI18n('en_GB').t;
const deps = {
  t,
  openDetail: vi.fn(),
  copyId: vi.fn(),
  sortHeader: (_field: string, label: string) => label,
  now: () => new Date(),
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
    view.rerender(<Probe pass={2} />);
    await vi.waitFor(() => expect(view.container.textContent).toBe('2'));
    await vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(2));
    expect(seen[0]?.map((feature) => feature.id)).toEqual(['core', 'write', 'extra']);
    expect(seen.at(-1)).toBe(seen[0]);
  });

  it('gives the core and write features by default', async () => {
    let ids: string[] = [];
    function Probe() {
      ids = useBookingFeatures(deps).features.map((feature) => feature.id);
      return null;
    }
    const view = await renderInWidget(<Probe />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(ids).toEqual(['core', 'write']));
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
