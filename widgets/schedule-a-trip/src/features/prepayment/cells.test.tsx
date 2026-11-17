import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyText } from '../../test/dom';
import { fakeInvoice } from '../../test/fake-aima';
import { booking, customer, doc, NOW, renderWithBilling, row } from '../../test/prepayment-fixtures';
import type { BookingContext } from '../extensions';
import {
  AmountCell,
  CreditsCell,
  InternalNotesCell,
  PrepaymentStatusCell,
  RegularizationCell,
  SchedulerErrorsCell,
} from './cells';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

const show = async (ui: React.ReactNode, invoices = [fakeInvoice()]) => {
  const rendered = await renderWithBilling(ui, { aima: { invoices } });
  unmount = rendered.view.unmount;
  return rendered;
};
const skeleton = () => document.body.querySelector('[data-skeleton]');
const charged = (value = {}) => doc({ chargeStartedAt: NOW.toISOString(), invoiceId: 'invoice-1', invoiceStatus: 'PENDING', chargeAmount: 50, ...value });

describe('PrepaymentStatusCell', () => {
  it('shows a skeleton while the document loads', async () => {
    await show(<PrepaymentStatusCell ctx={row({ state: undefined })} />);
    await vi.waitFor(() => expect(skeleton()).not.toBeNull());
  });

  it('shows the cached status, then the live one', async () => {
    const { aima } = await show(<PrepaymentStatusCell ctx={row({ state: charged() })} />);
    await vi.waitFor(() => expect(bodyText()).toBe('Paid'));
    expect(aima.callsTo('GET', '/invoices/invoice-1')).toHaveLength(1);
  });

  it.each<[string, Partial<BookingContext>, string]>([
    ['upcoming without a document', {}, 'To prepay'],
    ['a business booking', { customer: customer('Business') }, 'Not required (B2B)'],
    ['a cancelled booking without a document', { tab: 'cancelled' }, 'No prepayment from the widget'],
    ['archived data', { tab: 'completed', booking: booking({ startDate: '2024-01-01T00:00:00.000Z', plannedReturnDate: null }) }, 'Archived data'],
    ['a claim without an invoice', { state: doc({ chargeStartedAt: NOW.toISOString() }) }, 'Prepayment to verify'],
  ])('shows %s', async (_, ctx, label) => {
    await show(<PrepaymentStatusCell ctx={row(ctx)} />);
    await vi.waitFor(() => expect(bodyText()).toBe(label));
  });
});

describe('CreditsCell', () => {
  it('shows the credits status from the live invoice', async () => {
    await show(<CreditsCell ctx={row({ state: charged() })} />);
    await vi.waitFor(() => expect(bodyText()).toBe('To grant'));
  });

  it('shows granted and revoked from the scheduler and the refund', async () => {
    await show(<CreditsCell ctx={row({ state: charged({ creditsAdded: true, creditsRevoked: true }) })} />);
    await vi.waitFor(() => expect(bodyText()).toBe('Revoked'));
  });

  it('shows nothing without a document, and a skeleton while it loads', async () => {
    await show(<CreditsCell ctx={row({ state: null })} />);
    await vi.waitFor(() => expect(bodyText()).toBe('–'));
  });
});

describe('AmountCell', () => {
  it('shows the amount charged in the currency, with the warnings accepted', async () => {
    await show(<AmountCell ctx={row({ state: charged({ amountWarnings: ['below-minimum'] }) })} />);
    await vi.waitFor(() => expect(bodyText()).toBe('€50.00'));
    await vi.waitFor(() => expect(document.body.querySelector('[aria-label="Below the minimum"]')).not.toBeNull());
  });

  it('shows a dash without an amount', async () => {
    await show(<AmountCell ctx={row({ state: doc() })} />);
    await vi.waitFor(() => expect(bodyText()).toBe('–'));
  });
});

describe('RegularizationCell', () => {
  const toRegularize = { missingAmount: 10, at: NOW.toISOString() };

  it('shows the amount to regularize', async () => {
    await show(<RegularizationCell ctx={row({ state: doc({ toRegularize, regularizationPending: true }) })} />);
    await vi.waitFor(() => expect(bodyText()).toBe('To regularize (€10.00)'));
  });

  it('shows the date of the regularization, with its author and note', async () => {
    await show(
      <RegularizationCell ctx={row({ state: doc({ toRegularize, regularizationPending: false, regularizedAt: NOW.toISOString(), regularizedBy: 'user-9', regularizationNote: 'Paid' }) })} />,
    );
    await vi.waitFor(() => expect(bodyText()).toBe('Regularized on 10/03/2026'));
    await vi.waitFor(() => expect(document.body.querySelector('[aria-label="By user-9 · Paid"]')).not.toBeNull());
  });

  it('shows a dash with nothing to regularize', async () => {
    await show(<RegularizationCell ctx={row({ state: doc() })} />);
    await vi.waitFor(() => expect(bodyText()).toBe('–'));
  });
});

describe('SchedulerErrorsCell', () => {
  it('shows one chip per error', async () => {
    await show(<SchedulerErrorsCell ctx={row({ state: doc({ schedulerErrors: { vehicleMissing: NOW.toISOString(), creditsFailed: NOW.toISOString() } }) })} />);
    await vi.waitFor(() => expect(bodyText()).toBe('Credits not grantedNo vehicle'));
  });

  it('shows nothing without errors', async () => {
    await show(<SchedulerErrorsCell ctx={row({ state: doc() })} />);
    await vi.waitFor(() => expect(bodyText()).toBe(''));
  });
});

describe('InternalNotesCell', () => {
  it('shows the notes on one line', async () => {
    await show(<InternalNotesCell ctx={row({ state: doc({ internalNotes: 'Call before' }) })} />);
    await vi.waitFor(() => expect(bodyText()).toBe('Call before'));
  });

  it('shows a dash without notes, a skeleton while loading', async () => {
    await show(<InternalNotesCell ctx={row({ state: undefined })} />);
    await vi.waitFor(() => expect(skeleton()).not.toBeNull());
  });
});
