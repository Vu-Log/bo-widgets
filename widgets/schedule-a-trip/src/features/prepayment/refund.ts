import {
  chargeProduct,
  getInvoice,
  getRefundableAmount,
  listEntityWallets,
  refundInvoice,
  setWalletAvailableAmount,
} from '../../api/billing';
import type { ApiError } from '../../api/http';
import { getProductPrice } from '../../api/products';
import type { ScheduledBooking } from '../../api/schedule-a-trip';
import { refundPolicy, type RefundDecision, type RefundSettings } from '../../domain/refund-policy';
import type { BookingEvent, BookingStateDoc, BookingStatePatch } from '../../storage/booking-state';
import type { MoneyDeps } from './charge';
import {
  cancellationFeeNotes,
  EVENTS,
  isClearRefusal,
  missingAmount,
  refundNote,
  refundProgress,
} from './rules';
import { refuse, withEvents, writeOver, type WriteFailure } from './writes';

/** The settings a refund reads. */
export interface RefundPlanSettings extends RefundSettings {
  readonly cancellationFeesProductId: string;
}

/** The credits step of a plan. */
export type CreditsPlan =
  | { readonly kind: 'revoke'; readonly walletId: string; readonly balance: number }
  /** No wallet recorded by the scheduler: no credits were granted, nothing to revoke. */
  | { readonly kind: 'skip' }
  | { readonly kind: 'none' };

/**
 * What a refund will do, read before any write: shown to the operator, then executed.
 * Every amount comes from the API (refundable amount, fee product price, wallet balance).
 */
export interface RefundPlan {
  readonly bookingId: string;
  readonly invoiceId: string;
  readonly policy: RefundDecision;
  /** The refund to ask for; `null` when the prepayment is already refunded. */
  readonly refund: {
    readonly amount: number;
    readonly currency: string | null;
    readonly pspReference: string | null;
  } | null;
  /** The invoice was refunded but the document does not say so yet: record it only. */
  readonly recordRefundOnly: boolean;
  /** The fees to charge; `null` when none are due or they are already charged. */
  readonly fee: {
    readonly amount: number;
    readonly productId: string;
    /** The customer and the entity billed. */
    readonly userId: string;
    readonly entityId: string;
  } | null;
  /** A fee call has an unknown outcome: the operator must say whether it was charged. */
  readonly feeInDoubt: boolean;
  /** Fees charged by this refund (charged before, or to charge). */
  readonly feeTotal: number;
  readonly credits: CreditsPlan;
  /** Fees the credits left will not cover: written as `toRegularize`. */
  readonly missingAmount: number;
}

/** Why a refund cannot be planned. */
export type RefundPlanFailure =
  | { readonly kind: 'no-document' }
  | { readonly kind: 'no-invoice' }
  | { readonly kind: 'b2b' }
  | { readonly kind: 'complete' }
  | { readonly kind: 'no-cancellation-date' }
  | { readonly kind: 'invoice-not-paid'; readonly status: string }
  | { readonly kind: 'nothing-to-refund' }
  | { readonly kind: 'missing-billing' }
  | { readonly kind: 'wallet-not-found' }
  | { readonly kind: 'api'; readonly error: ApiError };

type PlanResult =
  { readonly ok: true; readonly plan: RefundPlan } | { readonly ok: false; readonly error: RefundPlanFailure };

const fail = (error: RefundPlanFailure): PlanResult => ({ ok: false, error });

/**
 * Plans the refund of a cancelled booking, with reads only: the live invoice must be `PAID` (or
 * already refunded by a refund this widget started), the refundable amount positive (checked
 * before the receipts are read), the policy from the cancellation and start dates (never changed),
 * the fee product price and the wallet balance read from the API.
 *
 * @param deps - API, fleet and clock.
 * @param input - The booking, its document and the settings.
 * @returns The plan, or why there is no refund to do.
 */
export async function planRefund(
  deps: Pick<MoneyDeps, 'authFetch' | 'fleetId'>,
  input: {
    readonly booking: Pick<ScheduledBooking, 'id' | 'userId' | 'startDate' | 'cancellationDate'>;
    readonly doc: BookingStateDoc | null;
    readonly settings: RefundPlanSettings;
  },
): Promise<PlanResult> {
  const { booking, doc, settings } = input;
  if (!doc) return fail({ kind: 'no-document' });
  const value = doc.value;
  if (!value.invoiceId) return fail({ kind: 'no-invoice' });
  if (value.isB2B === true) return fail({ kind: 'b2b' });
  const progress = refundProgress(value);
  if (progress.complete) return fail({ kind: 'complete' });
  if (!booking.cancellationDate) return fail({ kind: 'no-cancellation-date' });
  const policy = refundPolicy(new Date(booking.cancellationDate), new Date(booking.startDate), {
    refundFullHours: settings.refundFullHours,
    creditsRevokeHours: settings.creditsRevokeHours,
  });

  let refund: RefundPlan['refund'] = null;
  let recordRefundOnly = false;
  if (!progress.refunded) {
    const invoice = await getInvoice(deps.authFetch, deps.fleetId, value.invoiceId);
    if (!invoice.ok) return fail({ kind: 'api', error: invoice.error });
    const startedHere = (value.events ?? []).some((event) => event.type === EVENTS.refundStarted);
    if (invoice.data.status === 'REFUNDED' && startedHere) {
      recordRefundOnly = true;
    } else if (invoice.data.status !== 'PAID') {
      return fail({ kind: 'invoice-not-paid', status: invoice.data.status });
    } else {
      const refundable = await getRefundableAmount(deps.authFetch, deps.fleetId, value.invoiceId);
      if (!refundable.ok) return fail({ kind: 'api', error: refundable.error });
      // The amount first: the receipts of an invoice with nothing refundable may be empty.
      if (!(refundable.data.amount > 0)) return fail({ kind: 'nothing-to-refund' });
      refund = {
        amount: refundable.data.amount,
        currency: refundable.data.currency,
        pspReference: refundable.data.pspReferences[0] ?? null,
      };
    }
  }

  const feeDue = policy.kind !== 'full-refund' && progress.fee !== 'done';
  let fee: RefundPlan['fee'] = null;
  if (feeDue) {
    const userId = booking.userId;
    const entityId = value.entityId;
    if (!userId || !entityId) return fail({ kind: 'missing-billing' });
    const product = await getProductPrice(
      deps.authFetch,
      deps.fleetId,
      settings.cancellationFeesProductId,
    );
    if (!product.ok) return fail({ kind: 'api', error: product.error });
    fee = { amount: Math.max(0, product.data.price), productId: product.data.id, userId, entityId };
  }
  const feeTotal = fee?.amount ?? progress.feeAmount ?? 0;

  let credits: CreditsPlan = { kind: 'none' };
  let balanceUsed: number | null = progress.credits === 'done' ? progress.recordedBalance : null;
  if (policy.kind === 'refund-with-fee-and-credits-revocation' && progress.credits !== 'done') {
    if (!value.walletId) {
      credits = { kind: 'skip' };
    } else if (progress.credits === 'started' && progress.recordedBalance !== null) {
      credits = { kind: 'revoke', walletId: value.walletId, balance: progress.recordedBalance };
    } else {
      if (!value.entityId) return fail({ kind: 'missing-billing' });
      const wallets = await listEntityWallets(deps.authFetch, deps.fleetId, value.entityId);
      if (!wallets.ok) return fail({ kind: 'api', error: wallets.error });
      const wallet = wallets.data.find((candidate) => candidate.id === value.walletId);
      if (!wallet) return fail({ kind: 'wallet-not-found' });
      credits = { kind: 'revoke', walletId: wallet.id, balance: wallet.availableAmount ?? 0 };
    }
    balanceUsed = credits.kind === 'revoke' ? credits.balance : null;
  }

  return {
    ok: true,
    plan: {
      bookingId: booking.id,
      invoiceId: value.invoiceId,
      policy,
      refund,
      recordRefundOnly,
      fee,
      feeInDoubt: progress.fee === 'in-doubt',
      feeTotal,
      credits,
      missingAmount: balanceUsed === null ? 0 : missingAmount(feeTotal, balanceUsed),
    },
  };
}

/** What the operator answered about a fee call with an unknown outcome. */
export type FeeDecision = 'charged' | 'not-charged';

/**
 * The outcome of a refund. Every step is recorded as it is done, so a refund stopped on the way
 * resumes where it stopped (`planRefund` again), never paying or charging twice.
 *
 * - `done`: refunded, fees charged, credits revoked; `missingAmount` > 0 when a regularization is
 *   to do (the expiry starts only when nothing is).
 * - `fee-in-doubt`: a previous fee call has an unknown outcome: ask the operator first.
 * - `refund-refused` (nothing refunded), `refund-unknown` (check the invoice, then resume).
 * - `fee-refused` (no fee charged; resume charges it), `fee-unknown` (the fee may be charged: the
 *   operator must check before resuming).
 * - `credits-failed`: the wallet was not emptied; resume tries again with the balance recorded.
 * - `write-failed`: a step was done but the document could not record it, or a step was refused
 *   because someone else did it meanwhile (`refused`); `step` says which.
 */
export type RefundOutcome =
  | {
      readonly kind: 'done';
      readonly doc: BookingStateDoc;
      readonly missingAmount: number;
      readonly feeAmount: number;
    }
  | { readonly kind: 'fee-in-doubt' }
  | { readonly kind: 'refund-refused'; readonly error: ApiError }
  | { readonly kind: 'refund-unknown'; readonly error: ApiError }
  | { readonly kind: 'fee-refused'; readonly error: ApiError }
  | { readonly kind: 'fee-unknown'; readonly error: ApiError | null }
  | { readonly kind: 'credits-failed'; readonly error: ApiError }
  | {
      readonly kind: 'write-failed';
      readonly step: 'decision' | 'refund' | 'fee' | 'credits' | 'end';
      readonly failure: WriteFailure;
    };

const event = (deps: MoneyDeps, type: string, details?: Record<string, unknown>): BookingEvent => ({
  at: deps.now().toISOString(),
  by: deps.userId,
  type,
  ...(details ? { details } : {}),
});

/**
 * Runs a refund planned with {@link planRefund}, after the operator confirmed it:
 *
 * 1. a journal entry `refund-started` (over the version read), then the refund;
 * 2. `refundedAt`, with `cancellation-fee-started` (the fee amount) in the same write, then the
 *    fee invoice: a write-ahead mark, so that a lost answer is never charged twice;
 * 3. `cancellation-fee-charged`, with `credits-revocation-started` (the balance read) in the same
 *    write, then the wallet emptied;
 * 4. `creditsRevoked`, and either `toRegularize` with `regularizationPending`, or the start of the
 *    expiry when nothing is left to regularize.
 *
 * Each write is checked on the fresh document: a step another operator did meanwhile is refused.
 *
 * @param deps - API, storage, operator and clock.
 * @param plan - The plan read just before.
 * @param decision - The answer of the operator when a fee call has an unknown outcome.
 * @returns The outcome; never throws for a failure of the API or the storage.
 */
export async function executeRefund(
  deps: MoneyDeps,
  plan: RefundPlan,
  decision?: FeeDecision,
): Promise<RefundOutcome> {
  const { bookingId } = plan;
  let fee = plan.fee;
  let feeTotal = plan.feeTotal;

  if (plan.feeInDoubt) {
    if (!decision) return { kind: 'fee-in-doubt' };
    const decided = await writeOver(deps, bookingId, (current) => {
      if (refundProgress(current.value).fee !== 'in-doubt') return refuse('fee-not-in-doubt');
      const type = decision === 'charged' ? EVENTS.feeConfirmed : EVENTS.feeReleased;
      const amount = refundProgress(current.value).feeAmount;
      return {
        mode: 'update',
        patch: { events: withEvents(current.value.events, [event(deps, type, { amount })]) },
      };
    });
    if (!decided.ok) return { kind: 'write-failed', step: 'decision', failure: decided.error };
    if (decision === 'charged') {
      feeTotal = refundProgress(decided.value.value).feeAmount ?? feeTotal;
      fee = null;
    }
  }

  // Marks the next step in the write that records the previous one.
  const feeMark = (): BookingEvent[] =>
    fee === null ? [] : [event(deps, fee.amount > 0 ? EVENTS.feeStarted : EVENTS.feeSkipped, { amount: fee.amount })];

  if (plan.refund) {
    const refund = plan.refund;
    const started = await writeOver(deps, bookingId, (current) => {
      if (current.value.refundedAt) return refuse('already-refunded');
      return {
        mode: 'update',
        patch: {
          events: withEvents(current.value.events, [
            event(deps, EVENTS.refundStarted, { amount: refund.amount }),
          ]),
        },
      };
    });
    if (!started.ok) return { kind: 'write-failed', step: 'refund', failure: started.error };
    const refunded = await refundInvoice(deps.authFetch, deps.fleetId, plan.invoiceId, {
      amount: refund.amount,
      note: refundNote(bookingId),
      paymentIntentPspReference: refund.pspReference,
    });
    if (!refunded.ok) {
      return isClearRefusal(refunded.error)
        ? { kind: 'refund-refused', error: refunded.error }
        : { kind: 'refund-unknown', error: refunded.error };
    }
  }

  if (plan.refund || plan.recordRefundOnly) {
    const amount = plan.refund?.amount ?? null;
    const recorded = await writeOver(deps, bookingId, (current) => {
      if (current.value.refundedAt) return refuse('already-refunded');
      if (fee !== null && refundProgress(current.value).fee !== 'todo') return refuse('fee-started');
      return {
        mode: 'update',
        patch: {
          refundedAt: deps.now().toISOString(),
          events: withEvents(current.value.events, [
            event(deps, EVENTS.refunded, { amount }),
            ...feeMark(),
          ]),
        },
      };
    });
    if (!recorded.ok) return { kind: 'write-failed', step: 'refund', failure: recorded.error };
  } else if (fee !== null) {
    const marked = await writeOver(deps, bookingId, (current) => {
      if (refundProgress(current.value).fee !== 'todo') return refuse('fee-started');
      return {
        mode: 'update',
        patch: { events: withEvents(current.value.events, feeMark()) },
      };
    });
    if (!marked.ok) return { kind: 'write-failed', step: 'fee', failure: marked.error };
  }

  const creditsMark = (): BookingEvent[] =>
    plan.credits.kind === 'revoke'
      ? [event(deps, EVENTS.creditsStarted, { walletId: plan.credits.walletId, balance: plan.credits.balance })]
      : [];
  let creditsMarked = false;

  if (fee !== null && fee.amount > 0) {
    const feeAmount = fee.amount;
    const charged = await chargeProduct(deps.authFetch, deps.fleetId, {
      productId: fee.productId,
      amount: feeAmount,
      userId: fee.userId,
      entityId: fee.entityId,
      originId: deps.userId,
      productNotes: cancellationFeeNotes(bookingId),
      bookingRequestId: bookingId,
    });
    if (!charged.ok) {
      if (!isClearRefusal(charged.error)) return { kind: 'fee-unknown', error: charged.error };
      const released = await writeOver(deps, bookingId, (current) => ({
        mode: 'update',
        patch: {
          events: withEvents(current.value.events, [
            event(deps, EVENTS.feeReleased, { amount: feeAmount }),
          ]),
        },
      }));
      if (!released.ok) return { kind: 'write-failed', step: 'fee', failure: released.error };
      return { kind: 'fee-refused', error: charged.error };
    }
    const recorded = await writeOver(deps, bookingId, (current) => ({
      mode: 'update',
      patch: {
        events: withEvents(current.value.events, [
          event(deps, EVENTS.feeCharged, { amount: feeAmount, invoiceId: charged.data.invoiceId }),
          ...creditsMark(),
        ]),
      },
    }));
    if (!recorded.ok) return { kind: 'write-failed', step: 'fee', failure: recorded.error };
    creditsMarked = true;
  }

  if (plan.credits.kind === 'revoke') {
    const { walletId } = plan.credits;
    if (!creditsMarked) {
      const marked = await writeOver(deps, bookingId, (current) => {
        if (refundProgress(current.value).credits === 'done') return refuse('credits-done');
        return { mode: 'update', patch: { events: withEvents(current.value.events, creditsMark()) } };
      });
      if (!marked.ok) return { kind: 'write-failed', step: 'credits', failure: marked.error };
    }
    const emptied = await setWalletAvailableAmount(deps.authFetch, deps.fleetId, walletId, 0);
    if (!emptied.ok) return { kind: 'credits-failed', error: emptied.error };
  }

  const missing = plan.credits.kind === 'revoke' ? missingAmount(feeTotal, plan.credits.balance) : plan.missingAmount;
  const ended = await writeOver(deps, bookingId, (current) => {
    const at = deps.now().toISOString();
    const refundedAt = current.value.refundedAt;
    if (!refundedAt) return refuse('not-refunded');
    const closing: BookingEvent[] = [
      ...(plan.credits.kind === 'revoke' ? [event(deps, EVENTS.creditsRevoked)] : []),
      ...(plan.credits.kind === 'skip' ? [event(deps, EVENTS.creditsSkipped)] : []),
      event(deps, EVENTS.refundCompleted, { missingAmount: missing }),
    ];
    const patch: BookingStatePatch = {
      ...(plan.credits.kind === 'revoke' ? { creditsRevoked: true } : {}),
      events: withEvents(current.value.events, closing),
    };
    if (missing > 0) {
      return {
        mode: 'update',
        patch: { ...patch, toRegularize: { missingAmount: missing, at }, regularizationPending: true },
      };
    }
    return { mode: 'end', patch: { ...patch, refundedAt } };
  });
  if (!ended.ok) return { kind: 'write-failed', step: 'end', failure: ended.error };
  return { kind: 'done', doc: ended.value, missingAmount: missing, feeAmount: feeTotal };
}
