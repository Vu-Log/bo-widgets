import { describe, expect, it } from 'vitest';
import {
  aimaStatusOfTab,
  canRetryPayment,
  creditsStatus,
  LIST_TABS,
  prepaymentStatus,
  tabOfBooking,
} from './statuses';

describe('aimaStatusOfTab', () => {
  it('maps each tab to the AIMA status it lists', () => {
    expect(LIST_TABS.map(aimaStatusOfTab)).toEqual([
      'ALERT',
      'PENDING',
      'CONFIRMED',
      'CONFIRMED',
      'CANCELLED',
    ]);
  });
});

describe('tabOfBooking', () => {
  const inProgress = new Set(['trip-1']);
  const booking = (status: string, journeyId: string | null = null, completed = false) => ({
    status,
    journeyId,
    completed,
  });

  it('maps ALERT, PENDING and CANCELLED to their tab', () => {
    expect(tabOfBooking(booking('ALERT'), inProgress)).toBe('alert');
    expect(tabOfBooking(booking('PENDING'), inProgress)).toBe('upcoming');
    expect(tabOfBooking(booking('CANCELLED'), inProgress)).toBe('cancelled');
  });

  it('puts a CONFIRMED booking whose trip is in progress in Ongoing', () => {
    expect(tabOfBooking(booking('CONFIRMED', 'trip-1'), inProgress)).toBe('ongoing');
  });

  it('puts a completed CONFIRMED booking no longer in progress in Completed', () => {
    expect(tabOfBooking(booking('CONFIRMED', 'trip-2', true), inProgress)).toBe('completed');
    expect(tabOfBooking(booking('CONFIRMED', null, true), inProgress)).toBe('completed');
  });

  it('puts a CONFIRMED booking that is neither in progress nor completed in no tab', () => {
    expect(tabOfBooking(booking('CONFIRMED', 'trip-2'), inProgress)).toBeNull();
    expect(tabOfBooking(booking('CONFIRMED', 'trip-1', true), inProgress)).toBeNull();
  });

  it('puts an unknown status in no tab', () => {
    expect(tabOfBooking(booking('ONGOING'), inProgress)).toBeNull();
  });
});

describe('prepaymentStatus', () => {
  it('is NOT_CHARGED without a stored state, a claim or an invoice', () => {
    expect(prepaymentStatus(null, null)).toBe('NOT_CHARGED');
    expect(prepaymentStatus({}, null)).toBe('NOT_CHARGED');
    expect(prepaymentStatus({ chargeStartedAt: null, invoiceId: null }, 'PAID')).toBe(
      'NOT_CHARGED',
    );
  });

  it('is TO_VERIFY with a claim and no invoice', () => {
    expect(prepaymentStatus({ chargeStartedAt: '2026-03-10T10:00:00.000Z' }, null)).toBe(
      'TO_VERIFY',
    );
  });

  it('is UNKNOWN while the invoice status is not loaded', () => {
    expect(prepaymentStatus({ invoiceId: 'invoice-1' }, null)).toBe('UNKNOWN');
  });

  it.each([
    ['PENDING', 'PENDING'],
    ['PENDING_EXTERNAL_PAYMENT', 'PENDING'],
    ['PENDING_MANUAL_PAYMENT', 'PENDING'],
    ['PENDING_AUTHENTICATION', 'PENDING'],
    ['PAID', 'PAID'],
    ['REFUSED', 'FAILED'],
    ['ERROR', 'FAILED'],
    ['MOP_MISSING', 'FAILED'],
    ['REFUNDED', 'REFUNDED'],
    ['CANCELLED', 'CANCELLED'],
    ['SOMETHING_NEW', 'UNKNOWN'],
  ])('maps the invoice status %s to %s', (invoiceStatus, expected) => {
    expect(
      prepaymentStatus(
        { invoiceId: 'invoice-1', chargeStartedAt: '2026-03-10T10:00:00.000Z' },
        invoiceStatus,
      ),
    ).toBe(expected);
  });
});

describe('canRetryPayment', () => {
  it('allows a retry after REFUSED or ERROR only', () => {
    expect(canRetryPayment('REFUSED')).toBe(true);
    expect(canRetryPayment('ERROR')).toBe(true);
    expect(canRetryPayment('PAID')).toBe(false);
    expect(canRetryPayment('MOP_MISSING')).toBe(false);
    expect(canRetryPayment(null)).toBe(false);
  });
});

describe('creditsStatus', () => {
  const base = { invoiceStatus: null, cancelled: false };

  it('is REVOKED when the credits were revoked, whatever else', () => {
    expect(
      creditsStatus({ ...base, creditsAdded: true, creditsRevoked: true, cancelled: true }),
    ).toBe('REVOKED');
  });

  it('is GRANTED once the credits are added', () => {
    expect(creditsStatus({ ...base, creditsAdded: true })).toBe('GRANTED');
    expect(creditsStatus({ ...base, creditsAdded: true, cancelled: true })).toBe('GRANTED');
  });

  it('is PENDING_GRANT once the invoice is paid', () => {
    expect(creditsStatus({ ...base, invoiceStatus: 'PAID' })).toBe('PENDING_GRANT');
  });

  it('is PENDING_PREPAYMENT before', () => {
    expect(creditsStatus(base)).toBe('PENDING_PREPAYMENT');
    expect(
      creditsStatus({
        ...base,
        invoiceStatus: 'REFUSED',
        creditsAdded: false,
        creditsRevoked: false,
      }),
    ).toBe('PENDING_PREPAYMENT');
  });

  it('gives none for a cancelled booking without credits added', () => {
    expect(creditsStatus({ ...base, cancelled: true, invoiceStatus: 'PAID' })).toBeNull();
  });
});
