import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyText, button, click } from '../../../test/dom';
import { fakeInvoice } from '../../../test/fake-aima';
import { doc, renderWithBilling, row } from '../../../test/prepayment-fixtures';
import { notRetryableText, RetryDialog } from './RetryDialog';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

const stored = { chargeStartedAt: '2026-03-01T00:00:00.000Z', invoiceId: 'invoice-1' };
const open = async (status: string, state = doc(stored)) => {
  const rendered = await renderWithBilling(<RetryDialog ctx={row({ state })} onClose={() => undefined} />, {
    stored,
    aima: { invoices: [fakeInvoice({ status })] },
  });
  unmount = rendered.view.unmount;
  return rendered;
};

describe('notRetryableText', () => {
  it('explains each status', () => {
    expect(notRetryableText('PENDING_AUTHENTICATION').key).toBe('prepayment.retry.inProgress');
    expect(notRetryableText('MOP_MISSING').key).toBe('prepayment.retry.mopMissing');
    expect(notRetryableText('PAID').key).toBe('prepayment.retry.paid');
    expect(notRetryableText('REFUNDED')).toEqual({ key: 'prepayment.retry.notRetryable', params: { status: 'REFUNDED' } });
  });
});

describe('RetryDialog', () => {
  it('retries a refused payment after a confirmation', async () => {
    const { aima, stored: read } = await open('REFUSED');
    await vi.waitFor(() => expect(bodyText()).toContain('Retry the payment of the invoice invoice-1 (€50.00)?'));
    click('Retry the payment');
    await vi.waitFor(() => expect(bodyText()).toContain('The payment is being tried again.'));
    expect(aima.callsTo('POST', '/retry-payment')).toHaveLength(1);
    expect(read()?.value.invoiceStatus).toBe('PENDING');
  });

  it('explains why another status cannot be retried', async () => {
    await open('MOP_MISSING');
    await vi.waitFor(() => expect(bodyText()).toContain('The customer has no payment method'));
    expect(button('Retry the payment')?.disabled).toBe(true);
  });

  it('says so without an invoice', async () => {
    await open('PAID', doc());
    await vi.waitFor(() => expect(bodyText()).toContain('No invoice for this booking.'));
  });

  it('names the action on a 403', async () => {
    const { aima } = await open('ERROR');
    aima.failNext('retry', { status: 403 });
    await vi.waitFor(() => expect(button('Retry the payment')?.disabled).toBe(false));
    click('Retry the payment');
    await vi.waitFor(() => expect(bodyText()).toContain('You are not allowed to retry a payment'));
  });

  it('says when the invoice cannot be read', async () => {
    const rendered = await renderWithBilling(<RetryDialog ctx={row({ state: doc(stored) })} onClose={() => undefined} />, { stored });
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(bodyText()).toContain('The invoice could not be read.'));
  });
});
