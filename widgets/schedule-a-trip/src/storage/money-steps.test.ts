import { describe, expect, it } from 'vitest';
import { applyMoneyEvent, applyMoneyEvents, isMoneyStepEventType, MONEY_STEP_EVENT_TYPES, type MoneyEvent } from './money-steps';
import { MONEY_EVENT_TYPES } from './booking-state';

const AT = '2026-03-10T08:00:00.000Z';
const ev = (type: string, details?: Record<string, unknown>): MoneyEvent => ({ at: AT, by: 'operator-1', type, ...(details ? { details } : {}) });

describe('applyMoneyEvent', () => {
  it('clears the acceptance on a new claim or a release, and sets it on an acceptance', () => {
    expect(applyMoneyEvent({}, ev('charge-started'))).toEqual({ chargeAcceptedAt: null });
    expect(applyMoneyEvent({}, ev('charge-released'))).toEqual({ chargeAcceptedAt: null });
    expect(applyMoneyEvent({}, ev('charge-accepted'))).toEqual({ chargeAcceptedAt: AT });
  });

  it('starts a refund in doubt, with its author and amount, and reopens its completion', () => {
    expect(applyMoneyEvent({ refundCompletedAt: AT }, ev('refund-started', { amount: 50 }))).toEqual({
      refundStartedAt: AT,
      refundStartedBy: 'operator-1',
      refundAmount: 50,
      refundOutcome: 'in-doubt',
      refundCompletedAt: null,
    });
  });

  it('records the decision of an operator on a release, and keeps it when the step starts again', () => {
    expect(applyMoneyEvent({}, ev('refund-released', { decided: true }))).toEqual({ refundOutcome: 'released', refundDecidedAt: AT, refundDecidedBy: 'operator-1' });
    expect(applyMoneyEvent({ feeAmount: 15 }, ev('cancellation-fee-released', { decided: true }))).toEqual({
      feeOutcome: 'released',
      feeAmount: null,
      feeDecidedAt: AT,
      feeDecidedBy: 'operator-1',
    });
    expect(applyMoneyEvent({}, ev('refund-started'))).not.toHaveProperty('refundDecidedAt');
    expect(applyMoneyEvent({}, ev('cancellation-fee-started'))).not.toHaveProperty('feeDecidedAt');
  });

  it('never keeps a negative amount', () => {
    expect(applyMoneyEvent({}, ev('refund-started', { amount: -5 }))).toMatchObject({ refundAmount: null });
    expect(applyMoneyEvent({}, ev('cancellation-fee-started', { amount: -1, balance: -3 }))).toMatchObject({ feeAmount: null, walletBalanceBeforeFee: -3 });
  });

  it('ends a refund: recorded, confirmed by an operator, or released', () => {
    expect(applyMoneyEvent({}, ev('refunded', { amount: 50 }))).toEqual({ refundOutcome: 'confirmed', refundAmount: 50 });
    expect(applyMoneyEvent({}, ev('refunded', { amount: null }))).toEqual({ refundOutcome: 'confirmed' });
    expect(applyMoneyEvent({}, ev('refund-confirmed'))).toEqual({ refundOutcome: 'confirmed', refundDecidedAt: AT, refundDecidedBy: 'operator-1' });
    expect(applyMoneyEvent({}, ev('refund-released'))).toEqual({ refundOutcome: 'released' });
  });

  it('follows the fees: started with the balance, charged with the invoice, confirmed, skipped, released', () => {
    expect(applyMoneyEvent({}, ev('cancellation-fee-started', { amount: 15, balance: 4 }))).toMatchObject({
      feeStartedAt: AT,
      feeAmount: 15,
      walletBalanceBeforeFee: 4,
      feeOutcome: 'in-doubt',
      feeInvoiceId: null,
    });
    expect(applyMoneyEvent({ feeAmount: 15 }, ev('cancellation-fee-charged', { invoiceId: 'fee-1' }))).toEqual({
      feeOutcome: 'charged',
      feeChargedAt: AT,
      feeInvoiceId: 'fee-1',
      feeAmount: 15,
    });
    expect(applyMoneyEvent({ feeAmount: 15 }, ev('cancellation-fee-confirmed'))).toEqual({
      feeOutcome: 'confirmed',
      feeAmount: 15,
      feeDecidedAt: AT,
      feeDecidedBy: 'operator-1',
    });
    expect(applyMoneyEvent({}, ev('cancellation-fee-skipped'))).toEqual({ feeOutcome: 'skipped', feeAmount: null });
    expect(applyMoneyEvent({ feeAmount: 15 }, ev('cancellation-fee-released'))).toEqual({ feeOutcome: 'released', feeAmount: null });
  });

  it('follows the credits revocation and the end of the refund', () => {
    expect(applyMoneyEvent({}, ev('credits-revocation-started', { balance: 4 }))).toEqual({ creditsRevocationStartedAt: AT, creditsRevocationBalance: 4 });
    expect(applyMoneyEvent({}, ev('credits-revocation-skipped'))).toEqual({ creditsRevocationSkippedAt: AT });
    expect(applyMoneyEvent({}, ev('refund-completed'))).toEqual({ refundCompletedAt: AT });
  });

  it('sets nothing for an entry that is not a money step, and ignores invalid details', () => {
    expect(applyMoneyEvent({}, ev('internal-notes-saved'))).toEqual({});
    expect(applyMoneyEvent({}, ev('cancellation-fee-started', { amount: 'x', balance: Number.NaN }))).toMatchObject({ feeAmount: null, walletBalanceBeforeFee: null });
  });
});

describe('MONEY_STEP_EVENT_TYPES', () => {
  it('sets fields for every step type, and the journal keeps them when it is full', () => {
    for (const type of MONEY_STEP_EVENT_TYPES) {
      expect(isMoneyStepEventType(type)).toBe(true);
      expect(MONEY_EVENT_TYPES.has(type)).toBe(true);
      expect(Object.keys(applyMoneyEvent({}, ev(type))).length).toBeGreaterThan(0);
    }
    expect(isMoneyStepEventType('internal-notes-saved')).toBe(false);
  });
});

describe('applyMoneyEvents', () => {
  it('applies the steps in order, each one over the previous', () => {
    expect(
      applyMoneyEvents({}, [ev('refunded', { amount: 50 }), ev('cancellation-fee-started', { amount: 15, balance: 4 }), ev('cancellation-fee-charged', { invoiceId: 'fee-1' })]),
    ).toMatchObject({ refundOutcome: 'confirmed', feeOutcome: 'charged', feeAmount: 15, feeInvoiceId: 'fee-1' });
  });

  it('sets nothing without steps', () => {
    expect(applyMoneyEvents({ feeAmount: 15 }, [])).toEqual({});
  });
});
