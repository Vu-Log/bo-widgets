import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyText, click, dialogShown } from '../../test/dom';
import { renderWithBilling, row } from '../../test/prepayment-fixtures';
import { PrepaymentHost } from './Host';
import { createDialogStore } from './store';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

describe('PrepaymentHost', () => {
  it('shows nothing until an action opens a dialog, then the dialog of that action', async () => {
    const store = createDialogStore();
    const rendered = await renderWithBilling(<PrepaymentHost store={store} />);
    unmount = rendered.view.unmount;
    expect(bodyText()).toBe('');

    store.open({ action: 'notes', ctx: row() });
    await dialogShown();
    expect(bodyText()).toContain('Internal notes');

    click('Close');
    await vi.waitFor(() => expect(store.getSnapshot()).toBeNull());
  });

  it.each([
    ['charge', 'Prepayment'],
    ['retry', 'Retry the payment'],
    ['refund', 'Refund'],
    ['resume-refund', 'Refund'],
    ['verify', 'Prepayment to verify'],
    ['regularize', 'Mark as regularized'],
    ['undo-regularization', 'Undo the regularization'],
  ] as const)('opens the %s dialog', async (action, title) => {
    const store = createDialogStore();
    const rendered = await renderWithBilling(<PrepaymentHost store={store} />);
    unmount = rendered.view.unmount;
    store.open({ action, ctx: row() });
    await dialogShown();
    expect(document.body.querySelector('#prepayment-dialog-title')?.textContent).toBe(title);
  });
});
