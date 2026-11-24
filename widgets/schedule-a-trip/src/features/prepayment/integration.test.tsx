// Wires the real modules of the prepayment feature (feature, dialogs, workflows, API wrappers,
// queries, storage) through a minimal host; only the back office and the Vulog API are faked.
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyText, button, click, dialogShown } from '../../test/dom';
import { fakeInvoice } from '../../test/fake-aima';
import { FeatureHost } from '../../test/feature-host';
import { booking, customer, doc, NOW, renderWithBilling, row } from '../../test/prepayment-fixtures';
import type { ListTab } from '../../domain/statuses';
import { PrepaymentStatusCell } from './cells';
import { prepaymentFeature } from './index';
import { prepaymentDialogs } from './store';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  prepaymentDialogs.close();
  vi.restoreAllMocks();
});

const cell = (column: string) => document.body.querySelector(`[data-column="prepayment.${column}"]`)?.textContent ?? '';
const actionButton = (label: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>('[data-testid="actions"] button')].find((candidate) => candidate.textContent === label);

describe('the prepayment feature in a host', () => {
  it('prepays an upcoming booking from its row: claim, invoice, cells and journal', async () => {
    const rendered = await renderWithBilling(
      <FeatureHost feature={prepaymentFeature} booking={booking()} tab="upcoming" customer={customer()} />,
    );
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(cell('status')).toBe('To prepay'));

    actionButton('Prepay')?.click();
    await dialogShown();
    await vi.waitFor(() => expect(button('Prepay')?.disabled).toBe(false));
    // The dialog has its own "Prepay" button: the last one.
    [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((candidate) => candidate.textContent === 'Prepay')?.click();
    await vi.waitFor(() => expect(button('Charge €50.00')).toBeDefined());
    click('Charge €50.00');
    await vi.waitFor(() => expect(bodyText()).toContain('The prepayment is charged.'));
    click('Close');

    await vi.waitFor(() => expect(cell('status')).toBe('Payment in progress'));
    expect(cell('amount')).toBe('€50.00');
    expect(rendered.aima.callsTo('POST', '/invoices/product')).toHaveLength(1);
    expect(bodyText()).toContain('Prepayment charged · user-1');
  });

  it('refunds a cancelled booking with fees and credits, then regularizes it', async () => {
    const cancelled = booking({ status: 'CANCELLED', startDate: '2026-03-12T08:00:00.000Z', cancellationDate: '2026-03-12T07:30:00.000Z' });
    const rendered = await renderWithBilling(
      <FeatureHost feature={prepaymentFeature} booking={cancelled} tab={'cancelled' satisfies ListTab} customer={customer()} />,
      {
        stored: { chargeStartedAt: '2026-03-01T08:00:00.000Z', invoiceId: 'invoice-1', invoiceStatus: 'PAID', chargeAmount: 50, entityId: 'entity-1', creditsAdded: true, walletId: 'wallet-1' },
        aima: { invoices: [fakeInvoice()], wallets: [{ id: 'wallet-1', availableAmount: 5 }], productPrice: 15 },
      },
    );
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(actionButton('Refund')).toBeDefined());

    actionButton('Refund')?.click();
    await vi.waitFor(() => expect(bodyText()).toContain('Fees not covered by the credits left: €10.00'));
    [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((candidate) => candidate.textContent === 'Refund')?.click();
    await vi.waitFor(() => expect(button('Confirm the refund')).toBeDefined());
    click('Confirm the refund');
    await vi.waitFor(() => expect(bodyText()).toContain('€10.00 to regularize'));
    click('Close');

    await vi.waitFor(() => expect(cell('regularization')).toBe('To regularize (€10.00)'));
    expect(cell('credits')).toBe('Revoked');
    expect(rendered.stored()?.expiresAt).toBeUndefined();

    actionButton('Mark as regularized')?.click();
    await dialogShown();
    [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((candidate) => candidate.textContent === 'Mark as regularized')?.click();
    await vi.waitFor(() => expect(bodyText()).toContain('Marked as regularized.'));
    click('Close');

    await vi.waitFor(() => expect(cell('regularization')).toMatch(/^Regularized on/));
    expect(rendered.stored()?.expiresAt).toBeTruthy();
    expect(actionButton('Undo the regularization')).toBeDefined();
    expect(rendered.aima.callsTo('POST', '/refund')).toHaveLength(1);
  });

  it('recovers a charge whose answer was lost: to verify, then the invoice found and attached', async () => {
    const rendered = await renderWithBilling(
      <FeatureHost feature={prepaymentFeature} booking={booking()} tab="upcoming" customer={customer()} />,
    );
    unmount = rendered.view.unmount;
    rendered.aima.loseNextChargeAnswer();
    await vi.waitFor(() => expect(actionButton('Prepay')).toBeDefined());
    actionButton('Prepay')?.click();
    await dialogShown();
    await vi.waitFor(() => expect(button('Prepay')?.disabled).toBe(false));
    [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((candidate) => candidate.textContent === 'Prepay')?.click();
    await vi.waitFor(() => expect(button('Charge €50.00')).toBeDefined());
    click('Charge €50.00');
    await vi.waitFor(() => expect(bodyText()).toContain('The answer of the Vulog API was lost'));
    click('Close');

    await vi.waitFor(() => expect(cell('status')).toBe('Prepayment to verify'));
    actionButton('Verify the prepayment')?.click();
    await vi.waitFor(() => expect(bodyText()).toContain('The invoice invoice-new-1 is attached to the booking.'));
    click('Close');

    await vi.waitFor(() => expect(cell('status')).toBe('Payment in progress'));
    expect(rendered.aima.callsTo('POST', '/invoices/product')).toHaveLength(1);
    expect(rendered.stored()?.value.invoiceId).toBe('invoice-new-1');
  });

  it('offers no money action on a cancelled booking the widget never wrote, and says why', async () => {
    const rendered = await renderWithBilling(
      <FeatureHost feature={prepaymentFeature} booking={booking({ status: 'CANCELLED' })} tab="cancelled" customer={customer()} />,
    );
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(cell('status')).toBe('No prepayment from the widget'));
    expect([...document.body.querySelectorAll('[data-testid="actions"] button')].map((item) => item.textContent)).toEqual(['Internal notes', 'Refund']);
    expect(actionButton('Refund')).toMatchObject({ disabled: true, title: 'No prepayment from the widget' });
  });
});

describe('the invoices of the rows', () => {
  const ROWS = 60;
  const ids = (from: number, count: number) => Array.from({ length: count }, (_, index) => `invoice-${from + index}`);
  const invoices = ids(0, ROWS + 10).map((id) => fakeInvoice({ id, status: 'PENDING' }));
  const pendingRow = (invoiceId: string) =>
    row({
      booking: booking({ id: `booking-${invoiceId}` }),
      state: doc({ chargeStartedAt: NOW.toISOString(), invoiceId, invoiceStatus: 'PENDING', chargeAmount: 50 }),
    });

  /** Rows with their live status; "More" adds the rows of a next page. */
  function Rows() {
    const [invoiceIds, setInvoiceIds] = useState(() => ids(0, ROWS));
    return (
      <>
        <button type="button" onClick={() => setInvoiceIds([...invoiceIds, ...ids(ROWS, 10)])}>
          More
        </button>
        {invoiceIds.map((invoiceId) => (
          <div key={invoiceId} data-row={invoiceId}>
            <PrepaymentStatusCell ctx={pendingRow(invoiceId)} />
          </div>
        ))}
      </>
    );
  }
  const shown = (label: string) =>
    [...document.body.querySelectorAll('[data-row]')].filter((element) => element.textContent === label).length;

  it('reads the invoices of the rows mounted together in one call, never one by one', async () => {
    const rendered = await renderWithBilling(<Rows />, { aima: { invoices } });
    unmount = rendered.view.unmount;

    await vi.waitFor(() => expect(rendered.aima.callsTo('POST', '/invoices/list')).toHaveLength(1));
    await vi.waitFor(() => expect(shown('Payment in progress')).toBe(ROWS));
    expect(rendered.aima.callsTo('POST', '/invoices/list')[0]?.body).toEqual(ids(0, ROWS));
    expect(rendered.aima.calls.filter((call) => call.method === 'GET' && call.path.includes('/invoices/'))).toHaveLength(0);

    // The cells show the stored status until the live invoice arrives: wait for the call, not the label.
    click('More');
    await vi.waitFor(() => expect(rendered.aima.callsTo('POST', '/invoices/list')).toHaveLength(2));
    expect(rendered.aima.callsTo('POST', '/invoices/list')[1]?.body).toEqual(ids(ROWS, 10));
    await vi.waitFor(() => expect(shown('Payment in progress')).toBe(ROWS + 10));
  });

  it('reads one by one on an environment without the route (403), and never asks it again', async () => {
    const rendered = await renderWithBilling(<Rows />, { aima: { invoices } });
    unmount = rendered.view.unmount;
    rendered.aima.failNext('invoices-by-ids', { status: 403 }, true);

    await vi.waitFor(() => expect(rendered.aima.callsTo('GET', '/invoices/invoice-0')).toHaveLength(1));
    expect(rendered.aima.callsTo('POST', '/invoices/list')).toHaveLength(1);
    await vi.waitFor(() => expect(shown('Payment in progress')).toBe(ROWS));

    click('More');
    await vi.waitFor(() => expect(rendered.aima.callsTo('GET', `/invoices/invoice-${ROWS}`)).toHaveLength(1));
    expect(rendered.aima.callsTo('POST', '/invoices/list')).toHaveLength(1);
    await vi.waitFor(() => expect(shown('Payment in progress')).toBe(ROWS + 10));
  });
});
