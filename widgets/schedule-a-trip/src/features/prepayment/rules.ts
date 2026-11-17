import { addMinutes, differenceInCalendarDays, differenceInMinutes, subMinutes } from 'date-fns';
import type { ApiError } from '../../api/http';
import type { BilledInvoice } from '../../api/billing';
import { MAX_INVOICE_RANGE_DAYS } from '../../api/billing';
import type { ScheduledBooking } from '../../api/schedule-a-trip';
import type { Customer } from '../../api/users';
import { round2 } from '../../domain/charge-amount';
import {
  prepaymentStatus,
  type ListTab,
  type PrepaymentStatus,
} from '../../domain/statuses';
import type { BookingState, BookingStateDoc } from '../../storage/booking-state';

/*
 * The pure rules of the prepayment feature: who can be charged, which action a row offers, how the
 * steps of a refund are read back from the journal, and how a charge with a lost answer is found
 * again. No React, no I/O.
 */

/** Days after the last activity of a booking past which a missing document means "expired". */
export const ARCHIVE_AFTER_DAYS = 365;
/**
 * Minutes a money step with an unknown outcome (a charge claim, a refund or fees started) must be
 * old before an operator may say it was not done ("no invoice found, unlock", "the refund was not
 * done"): a call still in flight for another operator must not be undone under them.
 */
export const UNLOCK_MIN_CLAIM_AGE_MINUTES = 10;
/** Minutes searched before the claim: the claim date is a browser clock, the invoice one a server's. */
export const SEARCH_CLOCK_SKEW_MINUTES = 10;

/** The types of the journal entries this feature writes (and reads back for the refund steps). */
export const EVENTS = {
  chargeAccepted: 'charge-accepted',
  charged: 'charged',
  chargeAttached: 'charge-attached',
  chargeReleased: 'charge-released',
  paymentRetried: 'payment-retried',
  refundStarted: 'refund-started',
  refundReleased: 'refund-released',
  refundConfirmed: 'refund-confirmed',
  refunded: 'refunded',
  feeStarted: 'cancellation-fee-started',
  feeCharged: 'cancellation-fee-charged',
  feeReleased: 'cancellation-fee-released',
  feeConfirmed: 'cancellation-fee-confirmed',
  feeSkipped: 'cancellation-fee-skipped',
  creditsStarted: 'credits-revocation-started',
  creditsRevoked: 'credits-revoked',
  creditsSkipped: 'credits-revocation-skipped',
  refundCompleted: 'refund-completed',
  regularized: 'regularized',
  regularizationUndone: 'regularization-undone',
  notesSaved: 'internal-notes-saved',
} as const;

/** What a booking must give for the rules: dates and ids. */
export type RuleBooking = Pick<
  ScheduledBooking,
  'id' | 'startDate' | 'endDate' | 'plannedReturnDate' | 'cancellationDate' | 'userId' | 'profileId'
>;

const parse = (value: string | null): Date | null => {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * The last activity of a booking: the latest of its planned return, end, cancellation and start.
 *
 * @param booking - The AIMA booking.
 * @returns The date.
 */
export function lastActivity(booking: RuleBooking): Date {
  const dates = [booking.plannedReturnDate, booking.endDate, booking.cancellationDate]
    .map(parse)
    .filter((date): date is Date => date !== null);
  const start = new Date(booking.startDate);
  return dates.reduce((latest, date) => (date > latest ? date : latest), start);
}

/**
 * Whether the data of a booking was archived: no document, and a last activity more than
 * {@link ARCHIVE_AFTER_DAYS} days ago (the document expired). Read only: no action.
 *
 * @param booking - The AIMA booking.
 * @param state - Its document, `null` when there is none, `undefined` while loading.
 * @param now - The current date.
 * @returns `true` when archived; `false` while loading.
 */
export const isArchived = (
  booking: RuleBooking,
  state: BookingStateDoc | null | undefined,
  now: Date,
): boolean =>
  state === null && differenceInCalendarDays(now, lastActivity(booking)) > ARCHIVE_AFTER_DAYS;

/**
 * Who pays a prepayment.
 *
 * - `eligible`: the entity of the profile of the booking.
 * - `b2b`: a business profile, never prepaid.
 * - `loading`: the customer is not loaded yet.
 * - `no-customer`, `no-profile`, `no-entity`: the customer, the profile of the booking or its
 *   entity is unknown. The charge is refused (fail closed).
 */
export type Eligibility =
  | { readonly kind: 'eligible'; readonly entityId: string }
  | { readonly kind: 'b2b' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'no-customer' }
  | { readonly kind: 'no-profile' }
  | { readonly kind: 'no-entity' };

/**
 * Who pays the prepayment of a booking: the entity of the customer profile the booking was made
 * with (`profiles[].id` equal to `booking.profileId`), never a guess.
 *
 * @param booking - The AIMA booking.
 * @param customer - Its customer; `undefined` while loading, `null` when not found.
 * @returns The eligibility.
 */
export function prepaymentEligibility(
  booking: RuleBooking,
  customer: Customer | null | undefined,
): Eligibility {
  if (customer === undefined) return { kind: 'loading' };
  if (customer === null || booking.userId === null || customer.id !== booking.userId) {
    return { kind: 'no-customer' };
  }
  const profile = customer.profiles.find(
    (candidate) => candidate.id !== null && candidate.id === booking.profileId,
  );
  if (!profile) return { kind: 'no-profile' };
  if (profile.type === 'Business') return { kind: 'b2b' };
  if (!profile.entityId) return { kind: 'no-entity' };
  return { kind: 'eligible', entityId: profile.entityId };
}

/**
 * The notes of a prepayment invoice: the booking it is for and the hours it pays.
 *
 * @param bookingId - The AIMA booking id.
 * @param totalHours - Whole hours the amount pays for.
 * @returns `Schedule a trip {bookingId} – {N} h`.
 */
export const prepaymentNotes = (bookingId: string, totalHours: number): string =>
  `Schedule a trip ${bookingId} – ${totalHours} h`;

/**
 * The notes of a cancellation fee invoice.
 *
 * @param bookingId - The AIMA booking id.
 * @returns `Schedule a trip {bookingId} – cancellation fees`.
 */
export const cancellationFeeNotes = (bookingId: string): string =>
  `Schedule a trip ${bookingId} – cancellation fees`;

/**
 * The note of a refund.
 *
 * @param bookingId - The AIMA booking id.
 * @returns `Schedule a trip {bookingId} – refund of the prepayment`.
 */
export const refundNote = (bookingId: string): string =>
  `Schedule a trip ${bookingId} – refund of the prepayment`;

/** The HTTP statuses that surely mean "refused, nothing done" (not a proxy timeout nor a conflict). */
const CLEAR_REFUSAL_STATUSES: ReadonlySet<number> = new Set([400, 401, 403, 404, 422]);

/**
 * Whether a failed money call surely did nothing: an answer of the API refusing it (400, 401, 403,
 * 404, 422), or a request the widget or the back office did not send. A lost answer (`network`,
 * `aborted`), a 5xx, another 4xx (408, 409, 429… may come from a proxy while the API works), an
 * unreadable answer or a refusal of the back office after sending may hide an invoice or a
 * refund: it must be verified, never released.
 *
 * @param error - The failure of the call.
 * @returns `true` when no invoice was created.
 */
export function isClearRefusal(error: ApiError): boolean {
  switch (error.kind) {
    case 'not-allowed':
    case 'not-found':
    case 'invalid-request':
      return true;
    case 'session-lost':
      // 401 from the API, or no token: the request was refused or never sent.
      return true;
    case 'http':
      return CLEAR_REFUSAL_STATUSES.has(error.status);
    default:
      return false;
  }
}

/** The ISO creation range searched for the invoice of a claim. */
export interface InvoiceSearchRange {
  readonly startDate: string;
  readonly endDate: string;
}

/**
 * The creation range searched for the invoice of a claim: from a few minutes before the claim (the
 * clocks differ) to now plus the same margin, at most {@link MAX_INVOICE_RANGE_DAYS} days.
 *
 * @param chargeStartedAt - ISO date of the claim.
 * @param now - The current date.
 * @returns The range.
 * @throws {RangeError} When the claim date is invalid.
 */
export function invoiceSearchRange(chargeStartedAt: string, now: Date): InvoiceSearchRange {
  const claimed = new Date(chargeStartedAt);
  if (Number.isNaN(claimed.getTime())) throw new RangeError('Invalid claim date');
  const start = subMinutes(claimed, SEARCH_CLOCK_SKEW_MINUTES);
  const latest = addMinutes(start, MAX_INVOICE_RANGE_DAYS * 24 * 60);
  const wanted = addMinutes(now, SEARCH_CLOCK_SKEW_MINUTES);
  const end = wanted < latest ? wanted : latest;
  return { startDate: start.toISOString(), endDate: (end < start ? start : end).toISOString() };
}

/** What identifies the prepayment invoice of a booking. */
export interface InvoiceCriteria {
  readonly bookingId: string;
  readonly userId: string;
  readonly productId: string;
  readonly amount: number;
}

/**
 * The invoices of a search that are the prepayment of a booking: same amount (to the cent), same
 * customer, same product, and notes starting with `Schedule a trip {bookingId} –` (never a booking
 * whose id merely contains this one). Never a guess on the amount alone.
 *
 * @param invoices - The invoices of the search.
 * @param criteria - Booking, customer, product and amount charged.
 * @returns The matches, once each.
 */
export function matchPrepaymentInvoices(
  invoices: readonly BilledInvoice[],
  criteria: InvoiceCriteria,
): BilledInvoice[] {
  const prefix = `Schedule a trip ${criteria.bookingId} –`;
  const seen = new Set<string>();
  return invoices.filter((invoice) => {
    if (seen.has(invoice.id)) return false;
    const matches =
      invoice.amount !== null &&
      Math.abs(invoice.amount - criteria.amount) < 0.005 &&
      invoice.userId === criteria.userId &&
      invoice.productId === criteria.productId &&
      (invoice.productNotes ?? '').startsWith(prefix);
    if (matches) seen.add(invoice.id);
    return matches;
  });
}

/**
 * Whether "no invoice found, unlock" may be offered: the claim is at least
 * {@link UNLOCK_MIN_CLAIM_AGE_MINUTES} minutes old.
 *
 * @param chargeStartedAt - ISO date of the claim.
 * @param now - The current date.
 * @returns `true` when old enough; `false` for an invalid date.
 */
export function canUnlockClaim(chargeStartedAt: string, now: Date): boolean {
  const claimed = new Date(chargeStartedAt);
  if (Number.isNaN(claimed.getTime())) return false;
  return differenceInMinutes(now, claimed) >= UNLOCK_MIN_CLAIM_AGE_MINUTES;
}

/**
 * The fees a refund leaves unpaid: what the remaining credits did not cover.
 *
 * @param fee - The cancellation fees charged.
 * @param balance - The credits left in the wallet before it was emptied (a negative balance counts 0).
 * @returns The amount to regularize, 0 when covered.
 */
export function missingAmount(fee: number, balance: number): number {
  if (!(fee > 0)) return 0;
  const covered = Math.max(0, balance);
  return covered >= fee ? 0 : round2(fee - covered);
}

/** The step of the refund call: `in-doubt` when it was started and its outcome is unknown. */
export type RefundStep = 'todo' | 'in-doubt' | 'done';
/** The step of the cancellation fees in a refund. */
export type FeeStep = 'todo' | 'in-doubt' | 'done';
/** The step of the credits revocation in a refund. */
export type CreditsStep = 'todo' | 'started' | 'done';

/** The steps of a refund, as the document records them. */
export interface RefundProgress {
  /** The prepayment was refunded (`refundedAt`). */
  readonly refunded: boolean;
  /**
   * The refund call: `in-doubt` when started and neither recorded nor released (a lost answer, or
   * another operator calling right now): never refund again without checking.
   */
  readonly refund: RefundStep;
  /** ISO date of the last `refund-started` entry, `null` without one. */
  readonly refundStartedAt: string | null;
  /** ISO date of the last `cancellation-fee-started` entry, `null` without one. */
  readonly feeStartedAt: string | null;
  /** Wallet balance read before the fees were charged (the fees may be paid with credits). */
  readonly balanceBeforeFee: number | null;
  /**
   * `in-doubt`: the fee call was started and its outcome is unknown: never charge it again without
   * an operator checking.
   */
  readonly fee: FeeStep;
  /** Fees charged (or confirmed), `null` when none. */
  readonly feeAmount: number | null;
  readonly credits: CreditsStep;
  /** Balance recorded before the wallet was emptied. */
  readonly recordedBalance: number | null;
  /** The refund ended (completed entry, or a regularization recorded). */
  readonly complete: boolean;
}

/**
 * Reads the steps of a refund from the fields of the document (contract v2): `refundedAt`,
 * `refundOutcome`, `feeOutcome`, the credits revocation fields, `creditsRevoked`, `toRegularize`.
 * The journal is never read: it is an audit trail.
 *
 * @param value - The stored state of the booking.
 * @returns The steps done, in doubt or to do.
 */
export function refundProgress(value: BookingState): RefundProgress {
  const refunded = Boolean(value.refundedAt);
  const refund: RefundStep =
    refunded || value.refundOutcome === 'confirmed'
      ? 'done'
      : value.refundOutcome === 'in-doubt'
        ? 'in-doubt'
        : 'todo';
  const feeOutcome = value.feeOutcome ?? null;
  const fee: FeeStep =
    feeOutcome === 'in-doubt'
      ? 'in-doubt'
      : feeOutcome === 'charged' || feeOutcome === 'confirmed' || feeOutcome === 'skipped'
        ? 'done'
        : 'todo';
  const credits: CreditsStep =
    value.creditsRevoked === true || value.creditsRevocationSkippedAt
      ? 'done'
      : value.creditsRevocationStartedAt
        ? 'started'
        : 'todo';
  return {
    refunded,
    refund,
    refundStartedAt: value.refundStartedAt ?? null,
    feeStartedAt: value.feeStartedAt ?? null,
    balanceBeforeFee: value.walletBalanceBeforeFee ?? null,
    fee,
    feeAmount: fee === 'todo' || feeOutcome === 'skipped' ? null : (value.feeAmount ?? null),
    credits,
    recordedBalance: value.creditsRevocationBalance ?? null,
    complete: refunded && (Boolean(value.refundCompletedAt) || Boolean(value.toRegularize)),
  };
}

/** The actions of this feature. */
export type PrepaymentActionId =
  | 'charge'
  | 'verify'
  | 'retry'
  | 'refund'
  | 'resume-refund'
  | 'regularize'
  | 'undo-regularization'
  | 'notes';

/** The actions a row offers: one primary, the others in its menu. */
export interface RowActions {
  readonly primary: PrepaymentActionId | null;
  readonly menu: readonly PrepaymentActionId[];
  /** The primary action is shown but cannot run yet (customer loading). */
  readonly primaryDisabled: boolean;
}

/** What {@link rowActions} reads of a row. */
export interface RowInput {
  readonly booking: RuleBooking;
  readonly tab: ListTab;
  readonly state: BookingStateDoc | null | undefined;
  readonly customer: Customer | undefined;
}

const NONE: RowActions = { primary: null, menu: [], primaryDisabled: false };
const UPCOMING_TABS: readonly ListTab[] = ['upcoming', 'alert'];
const RETRYABLE_STATUSES = new Set(['REFUSED', 'ERROR']);
const NOT_REFUNDABLE_STATUSES = new Set(['REFUNDED', 'CANCELLED']);

/**
 * The actions of a row. Never a money action without a document (except the first charge of an
 * upcoming booking, protected by the claim), never any action on archived data, never a
 * prepayment for a business profile. The invoice status read is the one cached in the document:
 * the dialogs check the live one before any call.
 *
 * @param row - Booking, tab, document and customer.
 * @param now - The current date.
 * @returns The primary action and the menu.
 */
export function rowActions(row: RowInput, now: Date): RowActions {
  const { state, tab } = row;
  if (state === undefined || isArchived(row.booking, state, now)) return NONE;
  const value = state?.value;
  const menu: PrepaymentActionId[] = [];
  let primary: PrepaymentActionId | null = null;
  let primaryDisabled = false;
  const status = value?.invoiceStatus ?? null;

  if (value?.chargeStartedAt && !value.invoiceId) {
    primary = 'verify';
  } else if (UPCOMING_TABS.includes(tab)) {
    const eligibility = prepaymentEligibility(row.booking, row.customer);
    const b2b = eligibility.kind === 'b2b' || value?.isB2B === true;
    if (!b2b && !value?.invoiceId) {
      primary = 'charge';
      primaryDisabled = eligibility.kind === 'loading';
    } else if (value?.invoiceId) {
      if (status !== null && RETRYABLE_STATUSES.has(status)) primary = 'retry';
      else menu.push('retry');
    }
  } else if (tab === 'cancelled' && value?.invoiceId) {
    const progress = refundProgress(value);
    if (progress.refund === 'in-doubt' || (progress.refunded && !progress.complete)) {
      primary = 'resume-refund';
    } else if (!progress.refunded && (status === null || !NOT_REFUNDABLE_STATUSES.has(status))) {
      primary = 'refund';
    }
  } else if (value?.invoiceId) {
    menu.push('retry');
  }

  if (value?.regularizationPending === true) {
    if (primary === null) primary = 'regularize';
    else menu.push('regularize');
  }
  if (value?.regularizedAt) menu.push('undo-regularization');
  menu.push('notes');
  return { primary, menu, primaryDisabled };
}

/** Why an action of the feature is shown but cannot run (plan of the stored state). */
export type UnavailableReason = 'archived' | 'no-data';

/** An action shown disabled, with why. */
export interface UnavailableAction {
  readonly id: PrepaymentActionId;
  readonly reason: UnavailableReason;
}

/**
 * The actions a row shows disabled because its stored data is missing, so that an operator knows
 * why they are not offered (they never run, and never appear as the primary action):
 *
 * - `archived` (no document, last activity more than {@link ARCHIVE_AFTER_DAYS} days ago): the
 *   internal notes, and the refund on the Cancelled tab;
 * - `no-data` (no document on the Cancelled tab: no prepayment was made from the widget): the
 *   refund.
 *
 * @param row - Booking, tab, document and customer.
 * @param now - The current date.
 * @returns The disabled actions, none when the document exists or is loading.
 */
export function unavailableActions(row: RowInput, now: Date): UnavailableAction[] {
  if (row.state !== null) return [];
  if (isArchived(row.booking, row.state, now)) {
    return [
      ...(row.tab === 'cancelled' ? [{ id: 'refund', reason: 'archived' } as const] : []),
      { id: 'notes', reason: 'archived' },
    ];
  }
  return row.tab === 'cancelled' ? [{ id: 'refund', reason: 'no-data' }] : [];
}

/** What the prepayment column shows. */
export type PrepaymentDisplay =
  | PrepaymentStatus
  | 'LOADING'
  | 'ARCHIVED'
  | 'NO_DATA'
  | 'NONE_FROM_WIDGET'
  | 'NOT_REQUIRED';

/**
 * The prepayment status shown for a row.
 *
 * - No document: `ARCHIVED` after {@link ARCHIVE_AFTER_DAYS} days, else `NOT_CHARGED` (or
 *   `NOT_REQUIRED` for a business profile) on an upcoming booking, `NO_DATA` on an ongoing or
 *   completed one, `NONE_FROM_WIDGET` on a cancelled one.
 * - A document: `NOT_REQUIRED` for a business booking, else {@link prepaymentStatus}.
 *
 * @param row - Booking, tab, document and customer.
 * @param invoiceStatus - The live status of the invoice, `null` while not loaded (the cached one is
 *   used meanwhile).
 * @param now - The current date.
 * @returns What to show.
 */
export function prepaymentDisplay(
  row: RowInput,
  invoiceStatus: string | null,
  now: Date,
): PrepaymentDisplay {
  const { state, tab } = row;
  if (state === undefined) return 'LOADING';
  if (state === null) {
    if (isArchived(row.booking, state, now)) return 'ARCHIVED';
    if (UPCOMING_TABS.includes(tab)) {
      const eligibility = prepaymentEligibility(row.booking, row.customer);
      if (eligibility.kind === 'loading') return 'LOADING';
      return eligibility.kind === 'b2b' ? 'NOT_REQUIRED' : 'NOT_CHARGED';
    }
    return tab === 'cancelled' ? 'NONE_FROM_WIDGET' : 'NO_DATA';
  }
  if (state.value.isB2B === true) return 'NOT_REQUIRED';
  return prepaymentStatus(state.value, invoiceStatus ?? state.value.invoiceStatus ?? null);
}

/**
 * The names of the scheduler errors recorded, in a stable order.
 *
 * @param value - The stored state, if any.
 * @returns `vehicleMissing`, `enableFailed`, `allocationFailed`, `creditsFailed` when set.
 */
export function schedulerErrorNames(value: BookingState | null | undefined): string[] {
  const errors = value?.schedulerErrors;
  if (!errors) return [];
  return Object.entries(errors)
    .filter(([, date]) => typeof date === 'string' && date !== '')
    .map(([name]) => name)
    .sort();
}

/**
 * Whether the API accepted the invoice of the current claim (a 2xx whose answer gave no id): the
 * invoice exists, so the claim must never be unlocked. `chargeAcceptedAt` is cleared by every new
 * claim and every release.
 *
 * @param value - The stored state.
 * @returns `true` when `chargeAcceptedAt` is set.
 */
export function chargeAcceptedSinceClaim(value: BookingState): boolean {
  return Boolean(value.chargeAcceptedAt);
}
