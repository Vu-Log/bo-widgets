import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyText, button, click } from '../../../test/dom';
import { fakeInvoice } from '../../../test/fake-aima';
import { booking, doc, renderWithBilling, row } from '../../../test/prepayment-fixtures';
import type { BookingState } from '../../../storage/booking-state';
import { planFailureText, RefundDialog, refundOutcomeText } from './RefundDialog';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

const START = '2026-03-12T08:00:00.000Z';
const cancelledBefore = (hours: number) =>
  booking({ status: 'CANCELLED', startDate: START, cancellationDate: new Date(Date.parse(START) - hours * 3_600_000).toISOString() });
const prepaid: Partial<BookingState> = {
  chargeStartedAt: '2026-03-01T08:00:00.000Z',
  invoiceId: 'invoice-1',
  chargeAmount: 50,
  entityId: 'entity-1',
  creditsAdded: true,
  walletId: 'wallet-1',
};

const open = async (hours: number, balance = 40) => {
  const rendered = await renderWithBilling(
    <RefundDialog ctx={row({ tab: 'cancelled', booking: cancelledBefore(hours), state: doc(prepaid) })} onClose={() => undefined} />,
    { stored: prepaid, aima: { invoices: [fakeInvoice()], wallets: [{ id: 'wallet-1', availableAmount: balance }], productPrice: 15 } },
  );
  unmount = rendered.view.unmount;
  return rendered;
};

describe('RefundDialog', () => {
  it('shows the breakdown, confirms, then refunds', async () => {
    const { aima, stored } = await open(48);
    await vi.waitFor(() => expect(bodyText()).toContain('Refund of the prepayment: €50.00'));
    expect(bodyText()).toContain('full refund, no fees');
    expect(aima.callsTo('POST', '/refund')).toEqual([]);

    click('Refund');
    await vi.waitFor(() => expect(bodyText()).toContain('This refund cannot be undone. Confirm?'));
    click('Confirm the refund');

    await vi.waitFor(() => expect(bodyText()).toContain('The refund is done.'));
    expect(aima.callsTo('POST', '/refund')).toHaveLength(1);
    expect(stored()?.value.refundedAt).toBeTruthy();
  });

  it('warns about the fees left to regularize', async () => {
    await open(0.5, 5);
    await vi.waitFor(() => expect(bodyText()).toContain('Fees not covered by the credits left: €10.00, to regularize.'));
    expect(bodyText()).toContain('Credits revoked: €5.00 left in the wallet set to 0');
    click('Refund');
    await vi.waitFor(() => expect(button('Confirm the refund')).toBeDefined());
    click('Confirm the refund');
    await vi.waitFor(() => expect(bodyText()).toContain('Cancellation fees of €15.00 not covered by the credits left: €10.00 to regularize.'));
  });

  it('asks whether a fee with a lost answer was charged, once it is old enough', async () => {
    const { aima } = await open(10);
    aima.failNext('charge', { reject: new TypeError('Failed to fetch') });
    await vi.waitFor(() => expect(button('Refund')).toBeDefined());
    click('Refund');
    await vi.waitFor(() => expect(button('Confirm the refund')).toBeDefined());
    click('Confirm the refund');
    await vi.waitFor(() => expect(bodyText()).toContain('The answer of the cancellation fees was lost'));
    expect(bodyText()).toContain('The Vulog API could not be reached.');

    click('Read again');
    await vi.waitFor(() => expect(button('The fees were charged')).toBeDefined());
    expect(bodyText()).toContain('may still be in progress');
    expect(button('The fees were charged')?.disabled).toBe(true);
    expect(aima.callsTo('POST', '/invoices/product')).toHaveLength(1);
  });

  it('lets the operator answer about fees in doubt for long enough', async () => {
    const stored = {
      ...prepaid,
      refundedAt: '2026-03-01T09:00:00.000Z',
      feeStartedAt: '2026-03-01T09:00:00.000Z',
      feeAmount: 15,
      feeOutcome: 'in-doubt' as const,
      events: [{ at: '2026-03-01T09:00:00.000Z', by: 'user-1', type: 'cancellation-fee-started', details: { amount: 15 } }],
    };
    const rendered = await renderWithBilling(
      <RefundDialog ctx={row({ tab: 'cancelled', booking: cancelledBefore(10), state: doc(stored) })} onClose={() => undefined} />,
      { stored, aima: { invoices: [fakeInvoice({ status: 'REFUNDED', refundable: 0 })], productPrice: 15 } },
    );
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(button('The fees were charged')?.disabled).toBe(false));
    click('The fees were charged');
    await vi.waitFor(() => expect(bodyText()).toContain('will not be charged again'));
    click('Resume the refund');
    await vi.waitFor(() => expect(button('Confirm the refund')).toBeDefined());
    click('Confirm the refund');
    await vi.waitFor(() => expect(bodyText()).toContain('The refund is done.'));
    expect(rendered.aima.callsTo('POST', '/invoices/product')).toEqual([]);
  });

  it('explains why there is nothing to refund', async () => {
    const rendered = await renderWithBilling(
      <RefundDialog ctx={row({ tab: 'cancelled', booking: cancelledBefore(48), state: doc(prepaid) })} onClose={() => undefined} />,
      { stored: prepaid, aima: { invoices: [fakeInvoice({ status: 'PENDING' })] } },
    );
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(bodyText()).toContain('The invoice is PENDING: only a paid invoice is refunded.'));
  });
});

describe('planFailureText and refundOutcomeText', () => {
  it('names the action on a 403', () => {
    expect(planFailureText({ kind: 'api', error: { kind: 'not-allowed', status: 403 } })).toEqual({ key: 'prepayment.notAllowed.refund' });
    expect(refundOutcomeText({ kind: 'refund-refused', error: { kind: 'not-allowed', status: 403 }, releaseFailure: null }, String).text).toEqual({ key: 'prepayment.notAllowed.refund' });
    expect(refundOutcomeText({ kind: 'refund-unrecorded', amount: 50, failure: { kind: 'rate-limited' } }, String)).toEqual({
      severity: 'error',
      text: { key: 'prepayment.refund.refundUnrecorded', params: { amount: '50' } },
      detail: { key: 'prepayment.storage.rateLimited' },
    });
  });

  it('has a message for every failure', () => {
    for (const kind of ['no-document', 'no-invoice', 'b2b', 'complete', 'no-cancellation-date', 'nothing-to-refund', 'missing-billing', 'wallet-not-found'] as const) {
      expect(planFailureText({ kind }).key).toMatch(/^prepayment\./);
    }
    expect(refundOutcomeText({ kind: 'credits-failed', error: { kind: 'aborted' } }, String).severity).toBe('error');
    expect(refundOutcomeText({ kind: 'write-failed', step: 'end', failure: { kind: 'conflict' } }, String)).toMatchObject({ text: { key: 'prepayment.refund.writeFailed' }, detail: { key: 'prepayment.storage.changed' } });
    expect(refundOutcomeText({ kind: 'fee-charged-unrecorded', invoiceId: 'i-9', amount: 15, failure: { kind: 'rate-limited' } }, String).text).toEqual({ key: 'prepayment.refund.feeChargedUnrecorded', params: { amount: '15', invoiceId: 'i-9' } });
    expect(refundOutcomeText({ kind: 'needs-decision', step: 'fee', tooRecent: true }, String).text.key).toBe('prepayment.refund.decisionTooRecent');
    expect(refundOutcomeText({ kind: 'refund-refused', error: { kind: 'http', status: 400 }, releaseFailure: { kind: 'conflict' } }, String).detail).toEqual({ key: 'prepayment.storage.changed' });
    for (const kind of ['invalid-fee-price', 'wallet-balance-unknown'] as const) {
      expect(planFailureText(kind === 'invalid-fee-price' ? { kind, price: -1 } : { kind }).key).toMatch(/^prepayment\.refund\./);
    }
    expect(refundOutcomeText({ kind: 'fee-refused', error: { kind: 'http', status: 400 }, releaseFailure: null }, String).text.key).toBe('prepayment.refund.feeRefused');
    expect(refundOutcomeText({ kind: 'refund-unknown', error: { kind: 'aborted' } }, String).severity).toBe('warning');
  });
});
