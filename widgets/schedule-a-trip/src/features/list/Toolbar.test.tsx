import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInWidget } from '../../test/render';
import { Toolbar, type ToolbarProps } from './Toolbar';

const props = (overrides: Partial<ToolbarProps> = {}): ToolbarProps => ({
  search: '',
  onSearch: vi.fn(),
  filters: [
    { id: 'f1', label: 'No vehicle', tabs: ['upcoming'], test: () => true, needsAllPages: true },
    { id: 'f2', label: 'No return date', tabs: ['upcoming'], test: () => true, needsAllPages: true },
  ],
  activeFilters: new Set(['f2']),
  onToggleFilter: vi.fn(),
  density: 'standard',
  onDensity: vi.fn(),
  columns: [
    { id: 'model', label: 'Model', shown: true },
    { id: 'radius', label: 'Radius', shown: false },
  ],
  onToggleColumn: vi.fn(),
  updatedAt: Date.parse('2026-03-10T07:58:00Z'),
  now: new Date('2026-03-10T08:00:00Z'),
  onRefresh: vi.fn(),
  refreshing: false,
  ...overrides,
});

describe('Toolbar', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => unmount?.());

  const render = async (overrides: Partial<ToolbarProps> = {}) => {
    const p = props(overrides);
    const view = await renderInWidget(<Toolbar {...p} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.querySelector('input')).not.toBeNull());
    const button = (name: string) =>
      [...view.container.querySelectorAll<HTMLElement>('button, [role="button"]')].find(
        (b) => b.textContent === name || b.getAttribute('aria-label') === name,
      );
    return { ...view, p, button };
  };

  it('gives the text searched', async () => {
    const { container, p } = await render();
    const input = container.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'jane');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(p.onSearch).toHaveBeenCalledWith('jane');
  });

  it('toggles the filter chips, the active one pressed', async () => {
    const { button, p } = await render();
    expect(button('No return date')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('No vehicle')?.getAttribute('aria-pressed')).toBe('false');
    button('No vehicle')?.click();
    expect(p.onToggleFilter).toHaveBeenCalledWith('f1');
  });

  it('refreshes, says how old the rows are, and waits while refreshing', async () => {
    const { button, p, container } = await render();
    expect(container.textContent).toContain('Updated 2 minutes ago');
    button('Refresh')?.click();
    expect(p.onRefresh).toHaveBeenCalled();
    unmount?.();
    const busy = await render({ refreshing: true, updatedAt: 0 });
    expect((busy.button('Refresh') as HTMLButtonElement).disabled).toBe(true);
    expect(busy.container.textContent).not.toContain('Updated');
  });

  it('changes the density', async () => {
    const { button, p } = await render();
    button('Compact')?.click();
    expect(p.onDensity).toHaveBeenCalledWith('compact');
  });

  it('shows or hides a column from its menu', async () => {
    const { button, p } = await render();
    button('Columns')?.click();
    await vi.waitFor(() => expect(document.body.querySelectorAll('[role="menuitem"]')).toHaveLength(2));
    const items = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    items[1]?.click();
    items[0]?.click();
    expect(vi.mocked(p.onToggleColumn).mock.calls).toEqual([
      ['radius', true],
      ['model', false],
    ]);
  });

  it('keeps the age, refresh, density and columns together at the right, the search shrinking first', async () => {
    const { button, container } = await render();
    const css = [...document.querySelectorAll('style')].map((style) => style.textContent).join('\n');
    const rule = (element: Element | null | undefined) =>
      [...(element?.classList ?? [])]
        .filter((name) => name.startsWith('css-'))
        .map((name) => new RegExp(`\\.${name}\\{([^}]*)\\}`).exec(css)?.[1] ?? '')
        .join(';');

    const right = button('Columns')?.parentElement;
    expect(right?.contains(button('Refresh') ?? null)).toBe(true);
    expect(right?.contains(container.querySelector('[aria-label="Density"]'))).toBe(true);
    expect(right?.textContent).toContain('Updated 2 minutes ago');
    expect(right?.contains(button('No vehicle') ?? null)).toBe(false);
    expect(rule(right)).toContain('margin-left:auto');
    expect(rule(right?.parentElement)).toContain('flex-wrap:wrap');
    expect(rule(container.querySelector('input')?.closest('.MuiTextField-root'))).toContain('flex:1 1 200px');
    expect(button('No vehicle')?.className).toContain('MuiChip-sizeSmall');
  });
});
