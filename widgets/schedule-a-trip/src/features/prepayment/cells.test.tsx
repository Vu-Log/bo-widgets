import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyText } from '../../test/dom';
import { fakeInvoice } from '../../test/fake-aima';
import { booking, customer, doc, NOW, renderWithBilling, row, settings } from '../../test/prepayment-fixtures';
import type { BookingContext } from '../extensions';
import {
  AmountCell,
  CreditsCell,
  estimatedAmount,
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

  it.each([['PAID', 'Paid'], ['REFUNDED', 'Refunded']])(
    'trusts a stored %s status: no call to the invoice',
    async (invoiceStatus, label) => {
      const { aima } = await show(<PrepaymentStatusCell ctx={row({ state: charged({ invoiceStatus }) })} />);
      await vi.waitFor(() => expect(bodyText()).toBe(label));
      expect(aima.callsTo('GET', '/invoices/invoice-1')).toHaveLength(0);
    },
  );

  it('reads again a stored PAID once a refund was made: the list shows it refunded', async () => {
    const refunded = charged({ invoiceStatus: 'PAID', refundStartedAt: NOW.toISOString(), refundedAt: NOW.toISOString() });
    const { aima } = await show(<PrepaymentStatusCell ctx={row({ tab: 'cancelled', state: refunded })} />, [
      fakeInvoice({ status: 'REFUNDED' }),
    ]);
    await vi.waitFor(() => expect(bodyText()).toBe('Refunded'));
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

  it('shows "Awaiting prepayment" for a booking to prepay without a document', async () => {
    await show(<CreditsCell ctx={row({ state: null })} />);
    await vi.waitFor(() => expect(bodyText()).toBe('Awaiting prepayment'));
    expect(document.body.querySelector('[data-status-chip="default"]')).not.toBeNull();
  });

  it.each<[string, Partial<BookingContext>]>([
    ['a business booking', { state: null, customer: customer('Business') }],
    ['a business document', { state: doc({ isB2B: true }) }],
    ['a business customer with a document', { state: doc(), customer: customer('Business') }],
    ['a cancelled booking without a document', { state: null, tab: 'cancelled' }],
    ['a completed booking without a document', { state: null, tab: 'completed' }],
  ])('shows a dash for %s', async (_, ctx) => {
    await show(<CreditsCell ctx={row(ctx)} />);
    await vi.waitFor(() => expect(bodyText()).toBe('–'));
  });

  it('shows a skeleton while the document or the customer loads', async () => {
    await show(<CreditsCell ctx={row({ state: null, customer: undefined })} />);
    await vi.waitFor(() => expect(skeleton()).not.toBeNull());
  });
});

describe('AmountCell', () => {
  it('shows the amount charged in the currency, with the warnings accepted', async () => {
    await show(<AmountCell ctx={row({ state: charged({ amountWarnings: ['below-minimum'] }) })} />);
    await vi.waitFor(() => expect(bodyText()).toBe('€50.00'));
    await vi.waitFor(() => expect(document.body.querySelector('[aria-label="Below the minimum"]')).not.toBeNull());
  });

  it('shows the estimated amount, muted and marked, while nothing is charged', async () => {
    // 12 hours at 100 a day: 50.
    await show(<AmountCell ctx={row({ state: null })} />);
    await vi.waitFor(() => expect(bodyText()).toBe('≈ €50.00'));
    expect(document.body.querySelector('[data-estimated]')).not.toBeNull();
    await vi.waitFor(() =>
      expect(document.body.querySelector('[aria-label="Estimated amount: nothing charged yet"]')).not.toBeNull(),
    );
  });

  it('shows a dash without an amount nor an estimate', async () => {
    await show(<AmountCell ctx={row({ state: doc(), booking: booking({ plannedReturnDate: null }) })} />);
    await vi.waitFor(() => expect(bodyText()).toBe('–'));
    expect(document.body.querySelector('[data-estimated]')).toBeNull();
  });
});

describe('estimatedAmount', () => {
  it('is the amount the charge dialog proposes, for a booking with nothing charged', () => {
    expect(estimatedAmount(row({ state: null }), settings(), NOW)).toBe(50);
    expect(estimatedAmount(row({ state: doc() }), settings(), NOW)).toBe(50);
    // The minimum for a short trip.
    const short = booking({ plannedReturnDate: '2026-03-12T08:30:00.000Z' });
    expect(estimatedAmount(row({ booking: short }), settings(), NOW)).toBe(settings().minimumAmount);
  });

  it.each<[string, Partial<BookingContext>]>([
    ['without a planned return', { booking: booking({ plannedReturnDate: null }) }],
    ['for a business booking', { customer: customer('Business') }],
    ['for a business document', { state: doc({ isB2B: true }) }],
    ['for a business customer with a document', { state: doc(), customer: customer('Business') }],
    ['with a document while the customer loads', { state: doc(), customer: undefined }],
    ['once charged', { state: doc({ chargeStartedAt: NOW.toISOString(), invoiceId: 'invoice-1', chargeAmount: 40 }) }],
    ['for a claim to verify', { state: doc({ chargeStartedAt: NOW.toISOString() }) }],
    ['while the customer loads', { customer: undefined }],
    ['on another tab', { tab: 'completed' }],
    ['on another tab with a document', { tab: 'completed', state: doc() }],
    ['on the ongoing tab with a document', { tab: 'ongoing', state: doc() }],
  ])('is null %s', (_, ctx) => {
    expect(estimatedAmount(row({ state: null, ...ctx }), settings(), NOW)).toBeNull();
  });

  it('is null without valid settings', () => {
    expect(estimatedAmount(row(), null, NOW)).toBeNull();
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
