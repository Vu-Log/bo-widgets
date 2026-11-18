import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInWidget } from '../../test/render';
import { context } from '../../test/section';
import type { BookingFeature } from '../extensions';
import { menuActionsOf, primaryActionOf, RowActions } from './RowActions';

const run = vi.fn();
const features: BookingFeature[] = [
  { id: 'none', primaryAction: () => null, menuActions: () => [{ id: 'a', label: 'Open', run }] },
  {
    id: 'first',
    primaryAction: () => ({ id: 'pay', label: 'Prepay', run }),
    menuActions: () => [
      { id: 'pay', label: 'Prepay', run },
      { id: 'cancel', label: 'Cancel', run, tone: 'danger' },
    ],
  },
  { id: 'second', primaryAction: () => ({ id: 'allocate', label: 'Allocate', run }) },
  { id: 'plain' },
];

describe('primaryActionOf and menuActionsOf', () => {
  it('takes the first non-null primary action in the order of the registry', () => {
    expect(primaryActionOf(features, context())?.id).toBe('pay');
    expect(primaryActionOf([features[0]!, features[3]!], context())).toBeNull();
  });

  it('lists the other actions of every feature, without the primary one', () => {
    expect(menuActionsOf(features, context(), 'pay').map((action) => action.id)).toEqual(['a', 'cancel']);
  });
});

describe('RowActions', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => {
    unmount?.();
    run.mockClear();
  });

  it('runs the primary action and the actions of the menu', async () => {
    const view = await renderInWidget(<RowActions ctx={context()} features={features} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toContain('Prepay'));
    [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Prepay')?.click();
    expect(run).toHaveBeenCalledTimes(1);

    view.container.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')?.click();
    await vi.waitFor(() => expect(document.body.querySelectorAll('[role="menuitem"]')).toHaveLength(2));
    const cancel = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === 'Cancel',
    );
    cancel?.click();
    expect(run).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(document.body.querySelectorAll('[role="menuitem"]')).toHaveLength(0));
  });

  it('shows a disabled primary action as such, and no button without one', async () => {
    const view = await renderInWidget(
      <RowActions
        ctx={context()}
        features={[{ id: 'x', primaryAction: () => ({ id: 'p', label: 'Wait', run, disabled: true }) }]}
      />,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toContain('Wait'));
    expect([...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Wait')?.disabled).toBe(true);
    view.unmount();
    const plain = await renderInWidget(<RowActions ctx={context()} features={[]} />);
    unmount = plain.unmount;
    await vi.waitFor(() => expect(plain.container.querySelectorAll('button')).toHaveLength(1));
  });

  it('gives the reason of a disabled action: a tooltip on the button, a second line in the menu', async () => {
    const view = await renderInWidget(
      <RowActions
        ctx={context()}
        features={[
          {
            id: 'x',
            primaryAction: () => ({ id: 'p', label: 'Pay', run, disabledReason: 'Settings to fix' }),
            menuActions: () => [{ id: 'm', label: 'Refund', run, disabledReason: 'No data' }],
          },
        ]}
      />,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toContain('Pay'));
    const wrapper = view.container.querySelector('[data-disabled-reason="p"]');
    expect(wrapper?.getAttribute('aria-label')).toBe('Settings to fix');
    expect(wrapper?.querySelector('button')?.disabled).toBe(true);

    view.container.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')?.click();
    await vi.waitFor(() => expect(document.body.querySelector('[role="menuitem"]')?.textContent).toBe('RefundNo data'));
    expect(document.body.querySelector('[role="menuitem"]')?.getAttribute('aria-disabled')).toBe('true');
  });
});
