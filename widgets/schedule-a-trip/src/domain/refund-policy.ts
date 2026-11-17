/** The thresholds of the refund of a cancelled booking, in hours before its start. */
export interface RefundSettings {
  /** Cancelled at least this long before the start: refunded without fees. */
  readonly refundFullHours: number;
  /** Cancelled less than this long before the start: fees, and the credits are revoked. */
  readonly creditsRevokeHours: number;
}

/**
 * How a cancelled booking is refunded.
 *
 * - `full-refund`: the prepayment is refunded, no fees.
 * - `refund-with-fee`: refunded, and the cancellation fees are charged.
 * - `refund-with-fee-and-credits-revocation`: same, and the credits granted are revoked.
 */
export type RefundKind =
  'full-refund' | 'refund-with-fee' | 'refund-with-fee-and-credits-revocation';

/** The refund of a cancelled booking and how long before the start it was cancelled. */
export interface RefundDecision {
  readonly kind: RefundKind;
  /** Hours between the cancellation and the start; negative when cancelled after the start. */
  readonly hoursBeforeStart: number;
}

const HOUR_MS = 3_600_000;

/**
 * Decides the refund of a cancelled booking from how long before its start it was cancelled:
 * at least `refundFullHours` gives a full refund, at least `creditsRevokeHours` a refund with fees,
 * less (or after the start) a refund with fees and the credits revoked. The dates are only read,
 * never changed.
 *
 * @param cancelledAt - When the booking was cancelled.
 * @param startAt - When the booking was to start.
 * @param settings - The two thresholds, in hours.
 * @returns The kind of refund and the hours before the start.
 * @throws {RangeError} When a date is invalid.
 */
export function refundPolicy(
  cancelledAt: Date,
  startAt: Date,
  settings: RefundSettings,
): RefundDecision {
  const cancelled = cancelledAt.getTime();
  const start = startAt.getTime();
  if (Number.isNaN(cancelled) || Number.isNaN(start)) throw new RangeError('Invalid date');
  const hoursBeforeStart = (start - cancelled) / HOUR_MS;
  // The revocation is checked first: thresholds given the wrong way round still revoke the credits.
  if (hoursBeforeStart < settings.creditsRevokeHours) {
    return { kind: 'refund-with-fee-and-credits-revocation', hoursBeforeStart };
  }
  if (hoursBeforeStart < settings.refundFullHours)
    return { kind: 'refund-with-fee', hoursBeforeStart };
  return { kind: 'full-refund', hoursBeforeStart };
}
