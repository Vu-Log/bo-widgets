import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInWidget } from '../test/render';
import { StatusChip } from './StatusChip';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  unmount = undefined;
});

const styles = () => [...document.querySelectorAll('style')].map((style) => style.textContent).join('\n');

describe('StatusChip', () => {
  it('shows its label with a dot, in a soft background of its tone', async () => {
    const view = await renderInWidget(<StatusChip tone="success" label="Paid" />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toBe('Paid'));

    const chip = view.container.querySelector<HTMLElement>('[data-status-chip="success"]');
    expect(chip?.tagName).toBe('SPAN');
    expect(chip?.getAttribute('role')).toBeNull();
    const own = [...(chip?.classList ?? [])].find((name) => name.startsWith('css-'));
    // The dot, and a translucent background rather than a solid fill.
    expect(styles()).toMatch(new RegExp(`\\.${own}::before\\{[^}]*border-radius:50%`));
    expect(styles()).toMatch(new RegExp(`\\.${own}\\{[^}]*background-color:rgba\\(`));
  });

  it('uses the secondary text and a neutral background for the default tone', async () => {
    const view = await renderInWidget(<StatusChip tone="default" label="Revoked" />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.querySelector('[data-status-chip="default"]')?.textContent).toBe('Revoked'));
  });
});
