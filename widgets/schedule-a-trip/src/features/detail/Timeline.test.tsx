import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInSection } from '../../test/section';
import { Timeline } from './Timeline';

describe('Timeline', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => unmount?.());

  it('lists the steps with their state and their date in the zone of the fleet', async () => {
    const view = await renderInSection(
      <Timeline
        steps={[
          { id: 'created', state: 'done', at: '2026-03-01T23:30:00Z' },
          { id: 'prepaid', state: 'current', at: null },
          { id: 'cancelled', state: 'failed', at: null },
        ]}
      />,
      { value: { timeZone: 'Asia/Tokyo' } },
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.querySelectorAll('li')).toHaveLength(3));
    const items = [...view.container.querySelectorAll('li')];
    expect(items.map((item) => item.textContent)).toEqual(['Created02/03/2026', 'Prepaid', 'Cancelled']);
    expect(items[1]?.getAttribute('aria-current')).toBe('step');
    expect(items[2]?.getAttribute('data-state')).toBe('failed');
    expect(view.container.querySelector('ol')?.getAttribute('aria-label')).toBe('Lifecycle');
  });
});
