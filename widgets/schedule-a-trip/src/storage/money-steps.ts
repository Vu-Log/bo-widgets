/*
 * The money steps of a booking as first-level fields of its document. Each step the widget takes
 * is also written to the journal (`events`), but the journal is an audit trail only: every guard,
 * resume and decision reads these fields.
 *
 * `applyMoneyEvent` gives the fields a step sets: the writes call it with the entries they add, so
 * that a field and its audit entry are always written together, in one write.
 */

/** Outcome of the refund call: `in-doubt` while started and neither recorded nor released. */
export type RefundCallOutcome = 'in-doubt' | 'confirmed' | 'released';
/**
 * Outcome of the cancellation fees: `in-doubt` while started and unknown; `charged` (the widget
 * saw the invoice), `confirmed` (an operator said they were charged), `skipped` (nothing to
 * charge), `released` (refused, or an operator said they were not charged: to do again).
 */
export type FeeOutcome = 'in-doubt' | 'charged' | 'confirmed' | 'skipped' | 'released';

export const REFUND_CALL_OUTCOMES = ['in-doubt', 'confirmed', 'released'] as const;
export const FEE_OUTCOMES = ['in-doubt', 'charged', 'confirmed', 'skipped', 'released'] as const;

/** The fields of the money steps (all first-level, so that `query` can match them). */
export interface MoneyStepFields {
  /** The API accepted the invoice of the current claim (a 2xx without its id): never unlock. */
  chargeAcceptedAt?: string | null;
  refundStartedAt?: string | null;
  refundStartedBy?: string | null;
  /** Amount of the refund call started, `null` when only recorded. */
  refundAmount?: number | null;
  refundOutcome?: RefundCallOutcome | null;
  /** When and by whom an operator decided a refund in doubt. */
  refundDecidedAt?: string | null;
  refundDecidedBy?: string | null;
  feeStartedAt?: string | null;
  /** Fees charged, confirmed or started; `null` when skipped or released. */
  feeAmount?: number | null;
  /** Wallet balance read before the fees were charged (the fees may be paid with credits). */
  walletBalanceBeforeFee?: number | null;
  feeInvoiceId?: string | null;
  feeChargedAt?: string | null;
  feeOutcome?: FeeOutcome | null;
  feeDecidedAt?: string | null;
  feeDecidedBy?: string | null;
  creditsRevocationStartedAt?: string | null;
  /** Balance recorded before the wallet was emptied. */
  creditsRevocationBalance?: number | null;
  /** No wallet to empty: the revocation step is over without a call. */
  creditsRevocationSkippedAt?: string | null;
  /** The refund ended (refund, fees and credits done). */
  refundCompletedAt?: string | null;
}

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
const stringOf = (details: Record<string, unknown> | undefined, key: string): string | null => {
  const value = details?.[key];
  return typeof value === 'string' && value !== '' ? value : null;
};

/**
 * The fields a money step sets, from its journal entry. A non-money entry sets nothing.
 *
 * @param current - The fields before the step (for the amount kept by a confirmation).
 * @param event - The entry of the step.
 * @returns The fields to write with the entry.
 */
export function applyMoneyEvent(current: MoneyStepFields, event: MoneyEvent): MoneyStepFields {
  const { at, by, details } = event;
  switch (event.type) {
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
        refundAmount: numberOf(details, 'amount'),
        refundOutcome: 'in-doubt',
        refundDecidedAt: null,
        refundDecidedBy: null,
        refundCompletedAt: null,
      };
    case 'refunded':
      return { refundOutcome: 'confirmed', ...(numberOf(details, 'amount') === null ? {} : { refundAmount: numberOf(details, 'amount') }) };
    case 'refund-confirmed':
      return { refundOutcome: 'confirmed', refundDecidedAt: at, refundDecidedBy: by };
    case 'refund-released':
      return { refundOutcome: 'released' };
    case 'cancellation-fee-started':
      return {
        feeStartedAt: at,
        feeAmount: numberOf(details, 'amount'),
        walletBalanceBeforeFee: numberOf(details, 'balance'),
        feeOutcome: 'in-doubt',
        feeInvoiceId: null,
        feeChargedAt: null,
        feeDecidedAt: null,
        feeDecidedBy: null,
      };
    case 'cancellation-fee-charged':
      return {
        feeOutcome: 'charged',
        feeChargedAt: at,
        feeInvoiceId: stringOf(details, 'invoiceId'),
        feeAmount: numberOf(details, 'amount') ?? current.feeAmount ?? null,
      };
    case 'cancellation-fee-confirmed':
      return {
        feeOutcome: 'confirmed',
        feeAmount: numberOf(details, 'amount') ?? current.feeAmount ?? null,
        feeDecidedAt: at,
        feeDecidedBy: by,
      };
    case 'cancellation-fee-skipped':
      return { feeOutcome: 'skipped', feeAmount: null };
    case 'cancellation-fee-released':
      return { feeOutcome: 'released', feeAmount: null };
    case 'credits-revocation-started':
      return { creditsRevocationStartedAt: at, creditsRevocationBalance: numberOf(details, 'balance') };
    case 'credits-revocation-skipped':
      return { creditsRevocationSkippedAt: at };
    case 'refund-completed':
      return { refundCompletedAt: at };
    default:
      return {};
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
