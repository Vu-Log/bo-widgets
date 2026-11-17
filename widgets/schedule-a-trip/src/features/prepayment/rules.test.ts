import { BoError } from '@vulog/bo-widget-sdk';
import { describe, expect, it } from 'vitest';
import type { BilledInvoice } from '../../api/billing';
import { booking, customer, doc, NOW, row } from '../../test/prepayment-fixtures';
import { MONEY_EVENT_TYPES } from '../../storage/booking-state';
import {
  canUnlockClaim,
  chargeAcceptedSinceClaim,
  cancellationFeeNotes,
  EVENTS,
  invoiceSearchRange,
  isArchived,
  isClearRefusal,
  lastActivity,
  matchPrepaymentInvoices,
  missingAmount,
  prepaymentDisplay,
  prepaymentEligibility,
  prepaymentNotes,
  refundNote,
  refundProgress,
  rowActions,
  schedulerErrorNames,
} from './rules';

const ev = (type: string, details?: Record<string, unknown>) => ({
  at: NOW.toISOString(),
  by: 'operator-1',
  type,
  ...(details ? { details } : {}),
});

describe('lastActivity and isArchived', () => {
  it('takes the latest of the return, end and cancellation dates', () => {
    expect(
      lastActivity(
        booking({ plannedReturnDate: '2026-03-12T20:00:00.000Z', cancellationDate: '2026-03-13T00:00:00.000Z' }),
      ).toISOString(),
    ).toBe('2026-03-13T00:00:00.000Z');
  });

  it('falls back on the start without other dates', () => {
    expect(lastActivity(booking({ plannedReturnDate: null })).toISOString()).toBe('2026-03-12T08:00:00.000Z');
  });

  it('archives only a missing document past 365 days', () => {
    const old = booking({ startDate: '2025-01-01T00:00:00.000Z', plannedReturnDate: null });
    expect(isArchived(old, null, NOW)).toBe(true);
    expect(isArchived(old, doc(), NOW)).toBe(false);
    expect(isArchived(old, undefined, NOW)).toBe(false);
    expect(isArchived(booking(), null, NOW)).toBe(false);
  });
});

describe('prepaymentEligibility', () => {
  it('bills the entity of the profile of the booking', () => {
    expect(prepaymentEligibility(booking(), customer())).toEqual({ kind: 'eligible', entityId: 'entity-1' });
  });

  it('never prepays a business profile', () => {
    expect(prepaymentEligibility(booking(), customer('Business'))).toEqual({ kind: 'b2b' });
  });

  it('fails closed when the customer, the profile or the entity is unknown', () => {
    expect(prepaymentEligibility(booking(), undefined)).toEqual({ kind: 'loading' });
    expect(prepaymentEligibility(booking(), null)).toEqual({ kind: 'no-customer' });
    expect(prepaymentEligibility(booking({ userId: 'someone-else' }), customer())).toEqual({ kind: 'no-customer' });
    expect(prepaymentEligibility(booking({ profileId: 'profile-9' }), customer())).toEqual({ kind: 'no-profile' });
    expect(prepaymentEligibility(booking({ profileId: null }), { ...customer(), profiles: [{ id: null, type: 'Single', entityId: 'e' }] })).toEqual({ kind: 'no-profile' });
    expect(prepaymentEligibility(booking(), customer('Single', null))).toEqual({ kind: 'no-entity' });
  });
});

describe('notes', () => {
  it('names the booking in every invoice and refund', () => {
    expect(prepaymentNotes('b-1', 12)).toBe('Schedule a trip b-1 – 12 h');
    expect(cancellationFeeNotes('b-1')).toBe('Schedule a trip b-1 – cancellation fees');
    expect(refundNote('b-1')).toBe('Schedule a trip b-1 – refund of the prepayment');
  });
});

describe('isClearRefusal', () => {
  it('is true for a 4xx and a request never sent', () => {
    expect(isClearRefusal({ kind: 'http', status: 400 })).toBe(true);
    expect(isClearRefusal({ kind: 'http', status: 422 })).toBe(true);
    expect(isClearRefusal({ kind: 'not-allowed', status: 403 })).toBe(true);
    expect(isClearRefusal({ kind: 'not-found', status: 404 })).toBe(true);
    expect(isClearRefusal({ kind: 'session-lost', status: 401 })).toBe(true);
    expect(isClearRefusal({ kind: 'invalid-request', message: 'x' })).toBe(true);
  });

  it('is false whenever an invoice may exist', () => {
    expect(isClearRefusal({ kind: 'http', status: 500 })).toBe(false);
    expect(isClearRefusal({ kind: 'http', status: 408 })).toBe(false);
    expect(isClearRefusal({ kind: 'http', status: 409 })).toBe(false);
    expect(isClearRefusal({ kind: 'http', status: 429 })).toBe(false);
    expect(isClearRefusal({ kind: 'back-office', error: new BoError('TIMEOUT', 't') })).toBe(false);
    expect(isClearRefusal({ kind: 'network', cause: new TypeError() })).toBe(false);
    expect(isClearRefusal({ kind: 'aborted' })).toBe(false);
    expect(isClearRefusal({ kind: 'invalid-response', message: 'x' })).toBe(false);
  });
});

describe('invoiceSearchRange', () => {
  it('starts 10 minutes before the claim and ends 10 minutes after now', () => {
    expect(invoiceSearchRange('2026-03-10T08:00:00.000Z', new Date('2026-03-10T08:05:00.000Z'))).toEqual({
      startDate: '2026-03-10T07:50:00.000Z',
      endDate: '2026-03-10T08:15:00.000Z',
    });
  });

  it('stays within the 28 days the API takes', () => {
    const range = invoiceSearchRange('2026-01-01T00:00:00.000Z', NOW);
    expect(Date.parse(range.endDate) - Date.parse(range.startDate)).toBe(28 * 86_400_000);
  });

  it('refuses an invalid claim date', () => {
    expect(() => invoiceSearchRange('nope', NOW)).toThrow(RangeError);
  });
});

describe('matchPrepaymentInvoices', () => {
  const invoice = (overrides: Partial<BilledInvoice>): BilledInvoice => ({
    id: 'i-1',
    status: 'PAID',
    userId: 'customer-1',
    entityId: 'entity-1',
    productId: 'product-1',
    productNotes: 'Schedule a trip booking-1 – 12 h',
    amount: 50,
    billingDate: null,
    ...overrides,
  });
  const criteria = { bookingId: 'booking-1', userId: 'customer-1', productId: 'product-1', amount: 50 };

  it('keeps the invoices of the booking, customer, product and amount, once each', () => {
    expect(
      matchPrepaymentInvoices(
        [
          invoice({}),
          invoice({}),
          invoice({ id: 'cents', amount: 50.004 }),
          invoice({ id: 'amount', amount: 50.01 }),
          invoice({ id: 'notes', productNotes: null }),
          invoice({ id: 'user', userId: 'x' }),
          invoice({ id: 'product', productId: 'x' }),
          invoice({ id: 'no-amount', amount: null }),
          invoice({ id: 'longer-id', productNotes: 'Schedule a trip booking-12 – 12 h' }),
        ],
        criteria,
      ).map((match) => match.id),
    ).toEqual(['i-1', 'cents']);
  });

  it('gives nothing for no invoice', () => {
    expect(matchPrepaymentInvoices([], criteria)).toEqual([]);
  });
});

describe('canUnlockClaim', () => {
  it('waits 10 minutes', () => {
    expect(canUnlockClaim('2026-03-10T07:51:00.000Z', NOW)).toBe(false);
    expect(canUnlockClaim('2026-03-10T07:50:00.000Z', NOW)).toBe(true);
    expect(canUnlockClaim('nope', NOW)).toBe(false);
  });
});

describe('missingAmount', () => {
  it('is what the credits do not cover', () => {
    expect(missingAmount(15, 5)).toBe(10);
    expect(missingAmount(15, 15)).toBe(0);
    expect(missingAmount(15, -3)).toBe(15);
    expect(missingAmount(0, 0)).toBe(0);
    expect(missingAmount(10.1, 0.2)).toBe(9.9);
  });
});

describe('refundProgress', () => {
  it('reads nothing done from an empty journal', () => {
    expect(refundProgress(doc().value)).toEqual({
      refunded: false,
      refund: 'todo',
      refundStartedAt: null,
      feeStartedAt: null,
      balanceBeforeFee: null,
      fee: 'todo',
      feeAmount: null,
      credits: 'todo',
      recordedBalance: null,
      complete: false,
    });
  });

  it('follows the marks written before and after each call', () => {
    const value = doc({
      refundedAt: NOW.toISOString(),
      events: [
        ev(EVENTS.refundStarted),
        ev(EVENTS.refunded),
        ev(EVENTS.feeStarted, { amount: 15 }),
      ],
    }).value;
    expect(refundProgress(value)).toMatchObject({ refunded: true, fee: 'in-doubt', feeAmount: 15, complete: false });

    const charged = { ...value, events: [...(value.events ?? []), ev(EVENTS.feeCharged, { amount: 15 }), ev(EVENTS.creditsStarted, { balance: 4 })] };
    expect(refundProgress(charged)).toMatchObject({ fee: 'done', credits: 'started', recordedBalance: 4 });

    const released = { ...value, events: [...(value.events ?? []), ev(EVENTS.feeReleased)] };
    expect(refundProgress(released)).toMatchObject({ fee: 'todo', feeAmount: null });
  });

  it('is complete with the completed entry or a regularization', () => {
    expect(refundProgress(doc({ refundedAt: NOW.toISOString(), events: [ev(EVENTS.refundCompleted)] }).value).complete).toBe(true);
    expect(refundProgress(doc({ refundedAt: NOW.toISOString(), toRegularize: { missingAmount: 1, at: NOW.toISOString() } }).value).complete).toBe(true);
    expect(refundProgress(doc({ events: [ev(EVENTS.refundCompleted)] }).value).complete).toBe(false);
  });

  it('reads the credits as done from the flag', () => {
    expect(refundProgress(doc({ creditsRevoked: true }).value).credits).toBe('done');
    expect(refundProgress(doc({ events: [ev(EVENTS.creditsSkipped)] }).value).credits).toBe('done');
  });
});

describe('rowActions', () => {
  it('offers nothing while the document loads, nor on archived data', () => {
    expect(rowActions(row({ state: undefined }), NOW).primary).toBeNull();
    const archived = rowActions(row({ state: null, tab: 'cancelled', booking: booking({ startDate: '2024-01-01T00:00:00.000Z', plannedReturnDate: null }) }), NOW);
    expect(archived).toEqual({ primary: null, menu: [], primaryDisabled: false });
  });

  it('offers the prepayment of an upcoming booking, disabled while the customer loads', () => {
    expect(rowActions(row(), NOW)).toEqual({ primary: 'charge', menu: ['notes'], primaryDisabled: false });
    expect(rowActions(row({ customer: undefined }), NOW).primaryDisabled).toBe(true);
    expect(rowActions(row({ tab: 'alert' }), NOW).primary).toBe('charge');
  });

  it('never offers a prepayment for a business booking', () => {
    expect(rowActions(row({ customer: customer('Business') }), NOW).primary).toBeNull();
    expect(rowActions(row({ state: doc({ isB2B: true }) }), NOW).primary).toBeNull();
  });

  it('offers the verification of a claim without an invoice, on any tab', () => {
    const claimed = doc({ chargeStartedAt: NOW.toISOString() });
    expect(rowActions(row({ state: claimed }), NOW).primary).toBe('verify');
    expect(rowActions(row({ state: claimed, tab: 'cancelled' }), NOW).primary).toBe('verify');
  });

  it('offers the retry first after a failed payment, in the menu otherwise', () => {
    const charged = { chargeStartedAt: NOW.toISOString(), invoiceId: 'i-1' };
    expect(rowActions(row({ state: doc({ ...charged, invoiceStatus: 'REFUSED' }) }), NOW).primary).toBe('retry');
    expect(rowActions(row({ state: doc({ ...charged, invoiceStatus: 'PAID' }) }), NOW)).toEqual({ primary: null, menu: ['retry', 'notes'], primaryDisabled: false });
    expect(rowActions(row({ tab: 'ongoing', state: doc(charged) }), NOW).menu).toEqual(['retry', 'notes']);
  });

  it('offers no money action on a cancelled booking without a document', () => {
    expect(rowActions(row({ tab: 'cancelled', state: null }), NOW)).toEqual({ primary: null, menu: ['notes'], primaryDisabled: false });
  });

  it('offers the refund, its resume, then the regularization on a cancelled booking', () => {
    const charged = { chargeStartedAt: NOW.toISOString(), invoiceId: 'i-1' };
    expect(rowActions(row({ tab: 'cancelled', state: doc(charged) }), NOW).primary).toBe('refund');
    expect(rowActions(row({ tab: 'cancelled', state: doc({ ...charged, invoiceStatus: 'REFUNDED' }) }), NOW).primary).toBeNull();
    expect(rowActions(row({ tab: 'cancelled', state: doc({ ...charged, refundedAt: NOW.toISOString() }) }), NOW).primary).toBe('resume-refund');
    const pending = doc({ ...charged, refundedAt: NOW.toISOString(), toRegularize: { missingAmount: 3, at: NOW.toISOString() }, regularizationPending: true });
    expect(rowActions(row({ tab: 'cancelled', state: pending }), NOW).primary).toBe('regularize');
    const done = doc({ ...charged, refundedAt: NOW.toISOString(), toRegularize: { missingAmount: 3, at: NOW.toISOString() }, regularizationPending: false, regularizedAt: NOW.toISOString(), regularizedBy: 'u' });
    expect(rowActions(row({ tab: 'cancelled', state: done }), NOW)).toEqual({ primary: null, menu: ['undo-regularization', 'notes'], primaryDisabled: false });
  });
});

describe('prepaymentDisplay', () => {
  it('shows the state of a booking without a document by tab', () => {
    expect(prepaymentDisplay(row(), null, NOW)).toBe('NOT_CHARGED');
    expect(prepaymentDisplay(row({ customer: customer('Business') }), null, NOW)).toBe('NOT_REQUIRED');
    expect(prepaymentDisplay(row({ customer: undefined }), null, NOW)).toBe('LOADING');
    expect(prepaymentDisplay(row({ tab: 'ongoing' }), null, NOW)).toBe('NO_DATA');
    expect(prepaymentDisplay(row({ tab: 'cancelled' }), null, NOW)).toBe('NONE_FROM_WIDGET');
    expect(prepaymentDisplay(row({ booking: booking({ startDate: '2024-01-01T00:00:00.000Z', plannedReturnDate: null }) }), null, NOW)).toBe('ARCHIVED');
    expect(prepaymentDisplay(row({ state: undefined }), null, NOW)).toBe('LOADING');
  });

  it('prefers the live status of the invoice to the cached one', () => {
    const state = doc({ chargeStartedAt: NOW.toISOString(), invoiceId: 'i-1', invoiceStatus: 'PENDING' });
    expect(prepaymentDisplay(row({ state }), null, NOW)).toBe('PENDING');
    expect(prepaymentDisplay(row({ state }), 'PAID', NOW)).toBe('PAID');
    expect(prepaymentDisplay(row({ state: doc({ isB2B: true }) }), null, NOW)).toBe('NOT_REQUIRED');
  });
});

describe('refund steps', () => {
  it('reads a refund started and not recorded as in doubt, then done or released', () => {
    const started = doc({ events: [ev(EVENTS.refundStarted)] }).value;
    expect(refundProgress(started)).toMatchObject({ refund: 'in-doubt', refundStartedAt: NOW.toISOString() });
    expect(refundProgress({ ...started, events: [...(started.events ?? []), ev(EVENTS.refundReleased)] }).refund).toBe('todo');
    expect(refundProgress({ ...started, events: [...(started.events ?? []), ev(EVENTS.refundConfirmed)] }).refund).toBe('done');
    expect(refundProgress({ ...started, refundedAt: NOW.toISOString() }).refund).toBe('done');
  });

  it('keeps the balance read before the fees', () => {
    expect(refundProgress(doc({ events: [ev(EVENTS.feeStarted, { amount: 15, balance: 4 })] }).value)).toMatchObject({ balanceBeforeFee: 4, feeStartedAt: NOW.toISOString() });
  });

  it('offers to resume a refund in doubt', () => {
    const state = doc({ chargeStartedAt: NOW.toISOString(), invoiceId: 'i-1', events: [ev(EVENTS.refundStarted)] });
    expect(rowActions(row({ tab: 'cancelled', state }), NOW).primary).toBe('resume-refund');
  });
});

describe('chargeAcceptedSinceClaim', () => {
  it('is true only for an acceptance after the last claim', () => {
    expect(chargeAcceptedSinceClaim(doc({ events: [ev('charge-started'), ev(EVENTS.chargeAccepted)] }).value)).toBe(true);
    expect(chargeAcceptedSinceClaim(doc({ events: [ev('charge-started'), ev(EVENTS.chargeAccepted), ev('charge-released'), ev('charge-started')] }).value)).toBe(false);
    expect(chargeAcceptedSinceClaim(doc().value)).toBe(false);
  });
});

describe('EVENTS', () => {
  it('keeps every money step of the feature when the journal is full', () => {
    const notMoney = new Set<string>([EVENTS.paymentRetried, EVENTS.regularized, EVENTS.regularizationUndone, EVENTS.notesSaved]);
    for (const type of Object.values(EVENTS)) {
      if (!notMoney.has(type)) expect(MONEY_EVENT_TYPES.has(type)).toBe(true);
    }
  });
});

describe('schedulerErrorNames', () => {
  it('lists the errors set, sorted', () => {
    expect(schedulerErrorNames(doc({ schedulerErrors: { vehicleMissing: NOW.toISOString(), allocationFailed: NOW.toISOString() } }).value)).toEqual(['allocationFailed', 'vehicleMissing']);
    expect(schedulerErrorNames(null)).toEqual([]);
    expect(schedulerErrorNames(doc().value)).toEqual([]);
  });
});
