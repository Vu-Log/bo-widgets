import { differenceInHours } from 'date-fns';

/** The settings the prepayment amount depends on. */
export interface ChargeSettings {
  /** Price of a day. */
  readonly dayRate: number;
  /** Coefficient applied to the day rate. */
  readonly ratio: number;
  /** Floor of a computed amount; an amount below it is warned about. */
  readonly minimumAmount: number;
}

/** A duration in whole days and hours. */
export interface Duration {
  readonly days: number;
  /** 0 to 23. */
  readonly hours: number;
  readonly totalHours: number;
}

/** A warning about an amount an operator typed, accepted with a confirmation. */
export type AmountWarning = 'above-computed' | 'below-minimum';

/** The check of an amount: refused (not a positive number), or accepted with its warnings. */
export type AmountCheck =
  { readonly valid: false } | { readonly valid: true; readonly warnings: readonly AmountWarning[] };

/** Absorbs the binary error of a division (`0.3 / 0.1` is `2.9999999999999996`). */
const EPSILON = 1e-9;

/**
 * Rounds to 2 decimals, half away from zero.
 *
 * @param value - An amount.
 * @returns The amount with at most 2 decimals.
 */
export const round2 = (value: number): number =>
  (Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100;

const assertValidDate = (date: Date, name: string): void => {
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid ${name} date`);
};

/**
 * The prepayment amount of a booking: `round2(fullHours × 60 × dayRate / 1440 × ratio)`, at least
 * `minimumAmount`. `fullHours` counts the whole hours between start and end; an end at or before
 * the start counts 0 hours, so the minimum amount.
 *
 * @param start - Start of the booking.
 * @param end - Planned return of the booking, `null` when unknown.
 * @param settings - Day rate, ratio and minimum amount.
 * @returns The amount, or `null` without an end date.
 * @throws {RangeError} When a date is invalid.
 */
export function computeChargeAmount(
  start: Date,
  end: Date | null,
  settings: ChargeSettings,
): number | null {
  assertValidDate(start, 'start');
  if (end === null) return null;
  assertValidDate(end, 'end');
  const fullHours = Math.max(0, differenceInHours(end, start));
  const amount = round2(((fullHours * 60 * settings.dayRate) / 1440) * settings.ratio);
  return Math.max(amount, settings.minimumAmount);
}

const isPositiveAmount = (amount: number): boolean => Number.isFinite(amount) && amount > 0;

/**
 * The duration an amount pays for, in whole hours: `floor(amount / (dayRate / 24 × ratio))`. The
 * inverse of {@link computeChargeAmount}, before its rounding and its minimum.
 *
 * @param amount - An amount.
 * @param settings - Day rate and ratio.
 * @returns The duration, or `null` when the amount is not a positive number.
 */
export function estimateDuration(amount: number, settings: ChargeSettings): Duration | null {
  if (!isPositiveAmount(amount)) return null;
  const hourlyRate = (settings.dayRate / 24) * settings.ratio;
  const totalHours = Math.floor(amount / hourlyRate + EPSILON);
  return { days: Math.floor(totalHours / 24), hours: totalHours % 24, totalHours };
}

/**
 * Checks an amount an operator typed. `0`, a negative number or `NaN` is refused. Otherwise it is
 * accepted, with `above-computed` when it is greater than the computed amount and `below-minimum`
 * when it is less than `minimumAmount`. An amount below the computed one but not below the minimum
 * is a normal choice: no warning.
 *
 * @param amount - The amount typed.
 * @param computed - The computed amount ({@link computeChargeAmount}), `null` without an end date.
 * @param settings - The minimum amount.
 * @returns Whether the amount is valid, and its warnings.
 */
export function amountWarnings(
  amount: number,
  computed: number | null,
  settings: ChargeSettings,
): AmountCheck {
  if (!isPositiveAmount(amount)) return { valid: false };
  const warnings: AmountWarning[] = [];
  if (computed !== null && amount > computed) warnings.push('above-computed');
  if (amount < settings.minimumAmount) warnings.push('below-minimum');
  return { valid: true, warnings };
}
