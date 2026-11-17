import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInWidget } from '../../test/render';
import type { BookingKpi } from '../extensions';
import { KpiBar } from './KpiBar';

const kpis: BookingKpi[] = [
  { id: 'a', label: 'To prepay', tab: 'upcoming', filterId: 'fa', tone: 'warn' },
  { id: 'b', label: 'Failed', tab: 'upcoming', filterId: 'fb', tone: 'err' },
];

describe('KpiBar', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => unmount?.());

  it('shows each KPI with its count when known, the active one pressed', async () => {
    const onSelect = vi.fn();
    const view = await renderInWidget(
      <KpiBar kpis={kpis} counts={new Map([['a', 3]])} activeId="b" onSelect={onSelect} />,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.querySelectorAll('button')).toHaveLength(2));
    const [a, b] = [...view.container.querySelectorAll('button')];
    expect(a?.textContent).toBe('3To prepay');
    expect(b?.textContent).toBe('Failed');
    expect(b?.getAttribute('aria-pressed')).toBe('true');
    a?.click();
    expect(onSelect).toHaveBeenCalledWith(kpis[0]);
  });

  it('shows nothing without KPI', async () => {
    const view = await renderInWidget(<KpiBar kpis={[]} counts={new Map()} activeId={null} onSelect={vi.fn()} />);
    unmount = view.unmount;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(view.container.querySelector('[role="group"]')).toBeNull();
  });
});
