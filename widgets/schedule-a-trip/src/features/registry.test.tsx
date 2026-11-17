import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../i18n';
import { renderInWidget } from '../test/render';
import type { BookingFeature } from './extensions';
import { useBookingFeatures } from './registry';

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
  it('gives the core feature first, then the extra ones, and keeps them while nothing changes', async () => {
    const extra: BookingFeature[] = [{ id: 'extra' }];
    const seen: (readonly BookingFeature[])[] = [];
    function Probe({ pass }: { pass: number }) {
      seen.push(useBookingFeatures(deps, extra));
      return <p>{pass}</p>;
    }
    const view = await renderInWidget(<Probe pass={1} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toBe('1'));
    view.rerender(<Probe pass={2} />);
    await vi.waitFor(() => expect(view.container.textContent).toBe('2'));
    await vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(2));
    expect(seen[0]?.map((feature) => feature.id)).toEqual(['core', 'extra']);
    expect(seen.at(-1)).toBe(seen[0]);
  });

  it('gives the core feature alone by default', async () => {
    let ids: string[] = [];
    function Probe() {
      ids = useBookingFeatures(deps).map((feature) => feature.id);
      return null;
    }
    const view = await renderInWidget(<Probe />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(ids).toEqual(['core']));
  });
});
