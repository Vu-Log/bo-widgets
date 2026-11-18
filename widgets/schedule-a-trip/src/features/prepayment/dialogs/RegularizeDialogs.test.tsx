import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyText, button, click, dialogShown, field, typeInto } from '../../../test/dom';
import { doc, renderWithBilling, row } from '../../../test/prepayment-fixtures';
import type { BookingState } from '../../../storage/booking-state';
import { RegularizeDialog, UndoRegularizationDialog } from './RegularizeDialogs';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

const pending: Partial<BookingState> = {
  refundedAt: '2026-03-10T08:00:00.000Z',
  toRegularize: { missingAmount: 10, at: '2026-03-10T08:00:00.000Z' },
  regularizationPending: true,
};

describe('RegularizeDialog', () => {
  it('records the regularization with the note', async () => {
    const rendered = await renderWithBilling(<RegularizeDialog ctx={row({ tab: 'cancelled', state: doc(pending) })} onClose={() => undefined} />, { stored: pending });
    unmount = rendered.view.unmount;
    await dialogShown();
    await vi.waitFor(() => expect(bodyText()).toContain('Fees to regularize: €10.00'));

    typeInto(field(), 'Paid by card');
    click('Mark as regularized');

    await vi.waitFor(() => expect(bodyText()).toContain('Marked as regularized.'));
    expect(rendered.stored()?.value).toMatchObject({ regularizationNote: 'Paid by card', regularizedBy: 'user-1', regularizationPending: false });
  });

  it('refuses a note too long', async () => {
    const rendered = await renderWithBilling(<RegularizeDialog ctx={row({ state: doc(pending) })} onClose={() => undefined} />, { stored: pending });
    unmount = rendered.view.unmount;
    await dialogShown();
    typeInto(field(), 'x'.repeat(501));
    await vi.waitFor(() => expect(button('Mark as regularized')?.disabled).toBe(true));
  });

  it('says when the data are gone', async () => {
    const rendered = await renderWithBilling(<RegularizeDialog ctx={row({ state: doc(pending) })} onClose={() => undefined} />);
    unmount = rendered.view.unmount;
    await dialogShown();
    click('Mark as regularized');
    await vi.waitFor(() => expect(bodyText()).toContain('These data are no longer available.'));
  });
});

describe('UndoRegularizationDialog', () => {
  it('puts the regularization back to do after a confirmation', async () => {
    const done = { ...pending, regularizationPending: false, regularizedAt: '2026-03-11T08:00:00.000Z', regularizedBy: 'user-1' };
    const rendered = await renderWithBilling(<UndoRegularizationDialog ctx={row({ state: doc(done) })} onClose={() => undefined} />, { stored: done });
    unmount = rendered.view.unmount;
    await dialogShown();
    expect(bodyText()).toContain('The regularization will be to do again.');
    click('Undo the regularization');
    await vi.waitFor(() => expect(bodyText()).toContain('The regularization is to do again.'));
    expect(rendered.stored()?.value).toMatchObject({ regularizedAt: null, regularizationPending: true });
  });

  it('refuses when not regularized', async () => {
    const rendered = await renderWithBilling(<UndoRegularizationDialog ctx={row({ state: doc(pending) })} onClose={() => undefined} />, { stored: pending });
    unmount = rendered.view.unmount;
    await dialogShown();
    click('Undo the regularization');
    await vi.waitFor(() => expect(bodyText()).toContain('Someone else changed this booking meanwhile'));
  });
});
