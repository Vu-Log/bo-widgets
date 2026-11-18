import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInWidget } from '../test/render';
import { SkeletonCell } from './SkeletonCell';

let unmount: (() => void) | undefined;
afterEach(() => unmount?.());

describe('SkeletonCell', () => {
  it('renders a text skeleton hidden from screen readers, 80 % wide by default', async () => {
    const view = await renderInWidget(<SkeletonCell />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.querySelector('[data-skeleton]')).not.toBeNull());
    const skeleton = view.container.querySelector<HTMLElement>('[data-skeleton]');
    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
    expect(skeleton?.style.width).toBe('80%');
  });

  it('takes a width', async () => {
    const view = await renderInWidget(<SkeletonCell width={64} />);
    unmount = view.unmount;
    await vi.waitFor(() =>
      expect(view.container.querySelector<HTMLElement>('[data-skeleton]')?.style.width).toBe(
        '64px',
      ),
    );
  });
});
