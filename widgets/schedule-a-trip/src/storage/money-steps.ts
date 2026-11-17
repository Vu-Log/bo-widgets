/*
 * The money steps of a booking as first-level fields of its document. Each step the widget takes
 * is also written to the journal (`events`), but the journal is an audit trail only: every guard,
 * resume and decision reads these fields.
 *
 * `applyMoneyEvent` gives the fields a step sets: the writes call it with the entries they add, so
 * that a field and its audit entry are always written together, in one write.
 */

import type { BookingState, MONEY_STEP_FIELDS } from './booking-state';

/** Outcomes of the refund call: `in-doubt` while started and neither recorded nor released. */
export const REFUND_CALL_OUTCOMES = ['in-doubt', 'confirmed', 'released'] as const;
/** Outcome of the refund call. */
export type RefundCallOutcome = (typeof REFUND_CALL_OUTCOMES)[number];
/**
 * Outcomes of the cancellation fees: `in-doubt` while started and unknown; `charged` (the widget
 * saw the invoice), `confirmed` (an operator said they were charged), `skipped` (nothing to
 * charge), `released` (refused, or an operator said they were not charged: to do again).
 */
export const FEE_OUTCOMES = ['in-doubt', 'charged', 'confirmed', 'skipped', 'released'] as const;
/** Outcome of the cancellation fees. */
export type FeeOutcome = (typeof FEE_OUTCOMES)[number];

/** A field of a money step. */
export type MoneyStepField = (typeof MONEY_STEP_FIELDS)[number];
/** The fields of the money steps (all first-level, so that `query` can match them). */
export type MoneyStepFields = Partial<Pick<BookingState, MoneyStepField>>;

/** The journal entries that are money steps: each one sets fields ({@link applyMoneyEvent}). */
export const MONEY_STEP_EVENT_TYPES = [
  'charge-started',
  'charge-released',
  'charge-accepted',
  'refund-started',
  'refunded',
  'refund-confirmed',
  'refund-released',
  'cancellation-fee-started',
  'cancellation-fee-charged',
  'cancellation-fee-confirmed',
  'cancellation-fee-skipped',
  'cancellation-fee-released',
  'credits-revocation-started',
  'credits-revocation-skipped',
  'refund-completed',
] as const;
/** A journal entry type that is a money step. */
export type MoneyStepEventType = (typeof MONEY_STEP_EVENT_TYPES)[number];

const STEP_TYPES: ReadonlySet<string> = new Set(MONEY_STEP_EVENT_TYPES);

/**
 * Whether a journal entry type is a money step.
 *
 * @param type - The type of the entry.
 * @returns `true` for a {@link MoneyStepEventType}.
 */
export const isMoneyStepEventType = (type: string): type is MoneyStepEventType => STEP_TYPES.has(type);

/** An entry of the journal, as far as the money steps read it. */
export interface MoneyEvent {
  readonly at: string;
  readonly by: string | null;
  readonly type: string;
  readonly details?: Record<string, unknown> | undefined;
}

const numberOf = (details: Record<string, unknown> | undefined, key: string): number | null => {
  const value = details?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};
/** Whether an entry records the decision of an operator on a step in doubt. */
const decided = (details: Record<string, unknown> | undefined): boolean => details?.decided === true;
/** An amount of money: finite and not negative, else `null`. */
const amountOf = (details: Record<string, unknown> | undefined, key: string): number | null => {
  const value = numberOf(details, key);
  return value !== null && value >= 0 ? value : null;
};
const stringOf = (details: Record<string, unknown> | undefined, key: string): string | null => {
  const value = details?.[key];
  return typeof value === 'string' && value !== '' ? value : null;
};

/**
 * The fields a money step sets, from its journal entry. A non-money entry sets nothing. The
 * decision of an operator (`*DecidedAt`, `*DecidedBy`) is kept when the step starts again: it is
 * the last decision taken on that step.
 *
 * @param current - The fields before the step (for the amount kept by a confirmation).
 * @param event - The entry of the step.
 * @returns The fields to write with the entry.
 */
export function applyMoneyEvent(current: MoneyStepFields, event: MoneyEvent): MoneyStepFields {
  const { at, by, details } = event;
  const type = event.type;
  if (!isMoneyStepEventType(type)) return {};
  switch (type) {
    case 'charge-started':
    case 'charge-released':
      // A new claim, or none: the acceptance of a previous one no longer applies.
      return { chargeAcceptedAt: null };
    case 'charge-accepted':
      return { chargeAcceptedAt: at };
    case 'refund-started':
      return {
        refundStartedAt: at,
        refundStartedBy: by,
        refundAmount: amountOf(details, 'amount'),
        refundOutcome: 'in-doubt',
        refundCompletedAt: null,
      };
    case 'refunded':
      return { refundOutcome: 'confirmed', ...(amountOf(details, 'amount') === null ? {} : { refundAmount: amountOf(details, 'amount') }) };
    case 'refund-confirmed':
      return { refundOutcome: 'confirmed', refundDecidedAt: at, refundDecidedBy: by };
    case 'refund-released':
      // Refused by the API, or said not done by an operator (`decided`).
      return { refundOutcome: 'released', ...(decided(details) ? { refundDecidedAt: at, refundDecidedBy: by } : {}) };
    case 'cancellation-fee-started':
      return {
        feeStartedAt: at,
        feeAmount: amountOf(details, 'amount'),
        walletBalanceBeforeFee: numberOf(details, 'balance'),
        feeOutcome: 'in-doubt',
        feeInvoiceId: null,
        feeChargedAt: null,
      };
    case 'cancellation-fee-charged':
      return {
        feeOutcome: 'charged',
        feeChargedAt: at,
        feeInvoiceId: stringOf(details, 'invoiceId'),
        feeAmount: amountOf(details, 'amount') ?? current.feeAmount ?? null,
      };
    case 'cancellation-fee-confirmed':
      return {
        feeOutcome: 'confirmed',
        feeAmount: amountOf(details, 'amount') ?? current.feeAmount ?? null,
        feeDecidedAt: at,
        feeDecidedBy: by,
      };
    case 'cancellation-fee-skipped':
      return { feeOutcome: 'skipped', feeAmount: null };
    case 'cancellation-fee-released':
      return { feeOutcome: 'released', feeAmount: null, ...(decided(details) ? { feeDecidedAt: at, feeDecidedBy: by } : {}) };
    case 'credits-revocation-started':
      return { creditsRevocationStartedAt: at, creditsRevocationBalance: numberOf(details, 'balance') };
    case 'credits-revocation-skipped':
      return { creditsRevocationSkippedAt: at };
    case 'refund-completed':
      return { refundCompletedAt: at };
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

/**
 * The fields set by several steps, in order.
 *
 * @param current - The fields before the steps.
 * @param events - The entries of the steps.
 * @returns Every field the steps set.
 */
export const applyMoneyEvents = (
  current: MoneyStepFields,
  events: readonly MoneyEvent[],
): MoneyStepFields =>
  events.reduce<MoneyStepFields>((fields, event) => ({ ...fields, ...applyMoneyEvent({ ...current, ...fields }, event) }), {});
