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
  canUnlockClaim,
  cancellationFeeNotes,
  EVENTS,
  isClearRefusal,
  missingAmount,
  refundNote,
  refundProgress,
} from './rules';
import { refuse, withEvents, writeOver, type RefusedWrite, type WriteFailure } from './writes';

/** The settings a refund reads. */
export interface RefundPlanSettings extends RefundSettings {
  readonly cancellationFeesProductId: string;
}

/** A refund call to make. */
export interface RefundCall {
  readonly amount: number;
  readonly currency: string | null;
  readonly pspReference: string | null;
}

/**
 * The refund step of a plan.
 *
 * - `call`: refund this amount.
 * - `record-only`: a refund this widget started went through (the invoice says so): record it.
 * - `in-doubt`: a refund was started and its outcome is unknown, while the invoice still looks
 *   refundable: an operator must say whether it was done (`canDecide` once it is old enough: the
 *   call may still be running for another operator). `call` is what a new refund would be.
 * - `done`: already refunded.
 */
export type RefundStepPlan =
  | ({ readonly kind: 'call' } & RefundCall)
  | { readonly kind: 'record-only' }
  | {
      readonly kind: 'in-doubt';
      readonly startedAt: string;
      readonly canDecide: boolean;
      readonly call: RefundCall;
    }
  | { readonly kind: 'done' };

/** A fee invoice to create. */
export interface FeeCharge {
  readonly amount: number;
  readonly productId: string;
  /** The customer and the entity billed. */
  readonly userId: string;
  readonly entityId: string;
}

/**
 * The fee step of a plan.
 *
 * - `none`: no fees are due, or they are already charged.
 * - `skip`: the fee product costs 0: recorded, nothing charged.
 * - `charge`: charge these fees.
 * - `in-doubt`: a fee call has an unknown outcome: an operator must say whether it was charged
 *   (`canDecide` once it is old enough); `charge` is what a new call would be.
 */
export type FeeStepPlan =
  | { readonly kind: 'none' }
  | { readonly kind: 'skip' }
  | ({ readonly kind: 'charge' } & FeeCharge)
  | {
      readonly kind: 'in-doubt';
      readonly startedAt: string;
      readonly previousAmount: number | null;
      readonly canDecide: boolean;
      readonly charge: FeeCharge;
    };

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
  readonly refund: RefundStepPlan;
  readonly fee: FeeStepPlan;
  /** Fees charged by this refund before, when the fee step is `none` (`null` when none). */
  readonly feeCharged: number | null;
  readonly credits: CreditsPlan;
  /** The balance the regularization is computed from, `null` when no credits are revoked. */
  readonly balance: number | null;
}

/**
 * The fees and the amount to regularize of a plan, after the fee decision of the operator: one
 * function for what the dialog shows and what the refund writes.
 *
 * @param plan - The plan.
 * @param decision - The answer of the operator about fees in doubt.
 * @returns The fees charged by the refund and the part the credits do not cover.
 */
export function refundAmounts(
  plan: Pick<RefundPlan, 'fee' | 'feeCharged' | 'balance'>,
  decision?: FeeDecision,
): { readonly fee: number; readonly missing: number } {
  let fee: number;
  switch (plan.fee.kind) {
    case 'charge':
      fee = plan.fee.amount;
      break;
    case 'in-doubt':
      fee = decision === 'charged' ? (plan.fee.previousAmount ?? plan.fee.charge.amount) : plan.fee.charge.amount;
      break;
    case 'skip':
      fee = 0;
      break;
    case 'none':
      fee = plan.feeCharged ?? 0;
      break;
  }
  return { fee, missing: plan.balance === null ? 0 : missingAmount(fee, plan.balance) };
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
  | { readonly kind: 'invalid-fee-price'; readonly price: number }
  | { readonly kind: 'wallet-not-found' }
  | { readonly kind: 'wallet-balance-unknown' }
  | { readonly kind: 'api'; readonly error: ApiError };

/** The outcome of {@link planRefund}. */
export type RefundPlanResult =
  | { readonly ok: true; readonly plan: RefundPlan }
  | { readonly ok: false; readonly error: RefundPlanFailure };

const fail = (error: RefundPlanFailure): RefundPlanResult => ({ ok: false, error });

type Deps = Pick<MoneyDeps, 'authFetch' | 'fleetId' | 'now'>;

/** Reads what a new refund call would be: the refundable amount (> 0 before the receipts). */
async function readRefundCall(
  deps: Deps,
  invoiceId: string,
): Promise<{ ok: true; call: RefundCall | null } | { ok: false; error: ApiError }> {
  const refundable = await getRefundableAmount(deps.authFetch, deps.fleetId, invoiceId);
  if (!refundable.ok) return refundable;
  // The amount first: the receipts of an invoice with nothing refundable may be empty.
  if (!(refundable.data.amount > 0)) return { ok: true, call: null };
  return {
    ok: true,
    call: {
      amount: refundable.data.amount,
      currency: refundable.data.currency,
      pspReference: refundable.data.pspReferences[0] ?? null,
    },
  };
}

/**
 * Plans the refund of a cancelled booking, with reads only.
 *
 * - The refund: the live invoice must be `PAID` with a positive refundable amount. After a refund
 *   started with an unknown outcome, an invoice refunded (or refunding, or with nothing left to
 *   refund) is recorded only, never refunded again; one still refundable is "in doubt".
 * - The policy, from the cancellation and start dates (never changed).
 * - The fees: the price of the fee product (a negative price is refused); "in doubt" after a fee
 *   call with an unknown outcome.
 * - The credits: the wallet recorded by the scheduler and its balance (the one recorded before
 *   the fees, or before the revocation, when there is one).
 *
 * @param deps - API, fleet and clock.
 * @param input - The booking, its document and the settings.
 * @returns The plan, or why there is no refund to do.
 */
export async function planRefund(
  deps: Deps,
  input: {
    readonly booking: Pick<ScheduledBooking, 'id' | 'userId' | 'startDate' | 'cancellationDate'>;
    readonly doc: BookingStateDoc | null;
    readonly settings: RefundPlanSettings;
  },
): Promise<RefundPlanResult> {
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
  const now = deps.now();

  let refund: RefundStepPlan = { kind: 'done' };
  if (progress.refund !== 'done') {
    const invoice = await getInvoice(deps.authFetch, deps.fleetId, value.invoiceId);
    if (!invoice.ok) return fail({ kind: 'api', error: invoice.error });
    const inDoubt = progress.refund === 'in-doubt';
    const refunding = invoice.data.status === 'REFUNDED' || invoice.data.refundInProgress;
    if (inDoubt && refunding) {
      refund = { kind: 'record-only' };
    } else if (invoice.data.status !== 'PAID') {
      return fail({ kind: 'invoice-not-paid', status: invoice.data.status });
    } else {
      const read = await readRefundCall(deps, value.invoiceId);
      if (!read.ok) return fail({ kind: 'api', error: read.error });
      if (read.call === null) {
        if (!inDoubt) return fail({ kind: 'nothing-to-refund' });
        refund = { kind: 'record-only' };
      } else if (inDoubt) {
        const startedAt = progress.refundStartedAt ?? '';
        refund = { kind: 'in-doubt', startedAt, canDecide: canUnlockClaim(startedAt, now), call: read.call };
      } else {
        refund = { kind: 'call', ...read.call };
      }
    }
  }

  let fee: FeeStepPlan = { kind: 'none' };
  if (policy.kind !== 'full-refund' && progress.fee !== 'done') {
    const userId = booking.userId;
    const entityId = value.entityId;
    if (!userId || !entityId) return fail({ kind: 'missing-billing' });
    const product = await getProductPrice(deps.authFetch, deps.fleetId, settings.cancellationFeesProductId);
    if (!product.ok) return fail({ kind: 'api', error: product.error });
    const price = product.data.price;
    if (!Number.isFinite(price) || price < 0) return fail({ kind: 'invalid-fee-price', price });
    const charge: FeeCharge = { amount: price, productId: product.data.id, userId, entityId };
    if (progress.fee === 'in-doubt') {
      const startedAt = progress.feeStartedAt ?? '';
      fee = { kind: 'in-doubt', startedAt, previousAmount: progress.feeAmount, canDecide: canUnlockClaim(startedAt, now), charge };
    } else {
      fee = price > 0 ? { kind: 'charge', ...charge } : { kind: 'skip' };
    }
  }

  let credits: CreditsPlan = { kind: 'none' };
  let balance: number | null = progress.credits === 'done' ? progress.recordedBalance : null;
  if (policy.kind === 'refund-with-fee-and-credits-revocation' && progress.credits !== 'done') {
    const recorded =
      progress.credits === 'started' ? progress.recordedBalance : progress.balanceBeforeFee;
    if (!value.walletId) {
      credits = { kind: 'skip' };
    } else if (recorded !== null) {
      credits = { kind: 'revoke', walletId: value.walletId, balance: recorded };
    } else {
      if (!value.entityId) return fail({ kind: 'missing-billing' });
      const wallets = await listEntityWallets(deps.authFetch, deps.fleetId, value.entityId);
      if (!wallets.ok) return fail({ kind: 'api', error: wallets.error });
      const wallet = wallets.data.find((candidate) => candidate.id === value.walletId);
      if (!wallet) return fail({ kind: 'wallet-not-found' });
      if (wallet.availableAmount === null) return fail({ kind: 'wallet-balance-unknown' });
      credits = { kind: 'revoke', walletId: wallet.id, balance: wallet.availableAmount };
    }
    balance = credits.kind === 'revoke' ? credits.balance : null;
  }

  return {
    ok: true,
    plan: {
      bookingId: booking.id,
      invoiceId: value.invoiceId,
      policy,
      refund,
      fee,
      feeCharged: progress.fee === 'done' ? progress.feeAmount : null,
      credits,
      balance,
    },
  };
}

/** What the operator answered about fees with an unknown outcome. */
export type FeeDecision = 'charged' | 'not-charged';
/** What the operator answered about a refund with an unknown outcome. */
export type RefundAnswer = 'refunded' | 'not-refunded';

/** The answers of the operator about the steps in doubt of a plan. */
export interface RefundDecisions {
  readonly refund?: RefundAnswer;
  readonly fee?: FeeDecision;
}

/**
 * The outcome of a refund. Every step is recorded as it is done, so a refund stopped on the way
 * resumes where it stopped (`planRefund` again), never paying or charging twice.
 *
 * - `done`: refunded, fees charged, credits revoked; `missingAmount` > 0 when a regularization is
 *   to do (the expiry starts only when nothing is).
 * - `needs-decision`: a step has an unknown outcome: ask the operator first (`too-recent` when the
 *   step is too recent to be decided).
 * - `refund-refused` (nothing refunded; `releaseFailure` when the mark could not be cleared),
 *   `refund-unknown` (check the invoice, then resume).
 * - `fee-refused` (no fee charged; resume charges it), `fee-unknown` (the fee may be charged),
 *   `fee-charged-unrecorded` (the fee invoice exists but could not be recorded: never charge
 *   again).
 * - `credits-failed`: the wallet was not emptied; resume tries again with the balance recorded.
 * - `write-failed`: a write failed, or was refused because someone else did the step meanwhile.
 */
export type RefundOutcome =
  | {
      readonly kind: 'done';
      readonly doc: BookingStateDoc;
      readonly missingAmount: number;
      readonly feeAmount: number;
    }
  | { readonly kind: 'needs-decision'; readonly step: 'refund' | 'fee'; readonly tooRecent: boolean }
  | {
      readonly kind: 'refund-refused';
      readonly error: ApiError;
      readonly releaseFailure: WriteFailure | null;
    }
  | { readonly kind: 'refund-unknown'; readonly error: ApiError }
  | {
      readonly kind: 'fee-refused';
      readonly error: ApiError;
      readonly releaseFailure: WriteFailure | null;
    }
  | { readonly kind: 'fee-unknown'; readonly error: ApiError }
  | {
      readonly kind: 'fee-charged-unrecorded';
      readonly invoiceId: string | null;
      readonly amount: number;
      readonly failure: WriteFailure;
    }
  | { readonly kind: 'credits-failed'; readonly error: ApiError }
  | {
      readonly kind: 'write-failed';
      readonly step: 'decision' | 'refund' | 'fee' | 'credits' | 'end';
      readonly failure: WriteFailure;
    };

const entry = (deps: MoneyDeps, type: string, details?: Record<string, unknown>): BookingEvent => ({
  at: deps.now().toISOString(),
  by: deps.userId,
  type,
  ...(details ? { details } : {}),
});

/** Appends journal entries over the fresh document, after `check` accepts it. */
const mark = (
  deps: MoneyDeps,
  bookingId: string,
  entries: () => BookingEvent[],
  check: (current: BookingStateDoc) => RefusedWrite | null,
  extra: BookingStatePatch = {},
) =>
  writeOver(deps, bookingId, (current) => {
    const refused = check(current);
    if (refused) return refused;
    return {
      mode: 'update',
      patch: { ...extra, events: withEvents(current.value.events, entries()) },
    };
  });

/**
 * Runs a refund planned with {@link planRefund}, after the operator confirmed it:
 *
 * 1. the answers about the steps in doubt, each checked against the step shown (same start date);
 * 2. a `refund-started` mark (refused while another refund is started and not recorded), then the
 *    refund; a clear refusal writes `refund-released`;
 * 3. `refundedAt`, with `cancellation-fee-started` (the fee amount, and the wallet balance read
 *    before the fees) in the same write, then the fee invoice: a write-ahead mark, so that a lost
 *    answer is never charged twice;
 * 4. `cancellation-fee-charged`, with `credits-revocation-started` (the balance) in the same write,
 *    then the wallet emptied;
 * 5. `creditsRevoked`, and either `toRegularize` with `regularizationPending`, or the start of the
 *    expiry when nothing is left to regularize.
 *
 * @param deps - API, storage, operator and clock.
 * @param plan - The plan read just before.
 * @param decisions - The answers of the operator about the steps in doubt.
 * @returns The outcome; never throws for a failure of the API or the storage.
 */
export async function executeRefund(
  deps: MoneyDeps,
  plan: RefundPlan,
  decisions: RefundDecisions = {},
): Promise<RefundOutcome> {
  const { bookingId } = plan;
  let refundCall: RefundCall | null = null;
  let recordRefund = false;
  let feeCharge: FeeCharge | null = null;
  let feeSkip = plan.fee.kind === 'skip';

  // 1. The steps in doubt.
  if (plan.refund.kind === 'in-doubt') {
    const step = plan.refund;
    if (!decisions.refund || !step.canDecide) {
      return { kind: 'needs-decision', step: 'refund', tooRecent: !step.canDecide };
    }
    const answer = decisions.refund;
    const decided = await mark(
      deps,
      bookingId,
      () => [entry(deps, answer === 'refunded' ? EVENTS.refundConfirmed : EVENTS.refundReleased)],
      (current) => {
        const progress = refundProgress(current.value);
        return progress.refund === 'in-doubt' && progress.refundStartedAt === step.startedAt
          ? null
          : refuse('refund-not-in-doubt');
      },
    );
    if (!decided.ok) return { kind: 'write-failed', step: 'decision', failure: decided.error };
    if (answer === 'refunded') recordRefund = true;
    else refundCall = step.call;
  } else if (plan.refund.kind === 'call') {
    refundCall = plan.refund;
  } else if (plan.refund.kind === 'record-only') {
    recordRefund = true;
  }

  if (plan.fee.kind === 'in-doubt') {
    const step = plan.fee;
    if (!decisions.fee || !step.canDecide) {
      return { kind: 'needs-decision', step: 'fee', tooRecent: !step.canDecide };
    }
    const answer = decisions.fee;
    const decided = await mark(
      deps,
      bookingId,
      () => [entry(deps, answer === 'charged' ? EVENTS.feeConfirmed : EVENTS.feeReleased, { amount: step.previousAmount })],
      (current) => {
        const progress = refundProgress(current.value);
        return progress.fee === 'in-doubt' && progress.feeStartedAt === step.startedAt
          ? null
          : refuse('fee-not-in-doubt');
      },
    );
    if (!decided.ok) return { kind: 'write-failed', step: 'decision', failure: decided.error };
    if (answer === 'not-charged') feeCharge = step.charge;
  } else if (plan.fee.kind === 'charge') {
    feeCharge = plan.fee;
  }
  const amounts = refundAmounts(plan, decisions.fee);

  // Marks the fee step in the write that records the previous one.
  const feeMarks = (): BookingEvent[] => {
    if (feeCharge) {
      return [entry(deps, EVENTS.feeStarted, { amount: feeCharge.amount, balance: plan.balance })];
    }
    return feeSkip ? [entry(deps, EVENTS.feeSkipped, { amount: 0 })] : [];
  };
  const feeTodo = (current: BookingStateDoc) =>
    (feeCharge || feeSkip) && refundProgress(current.value).fee !== 'todo' ? refuse('fee-started') : null;

  // 2. The refund.
  if (refundCall) {
    const call = refundCall;
    const started = await mark(
      deps,
      bookingId,
      () => [entry(deps, EVENTS.refundStarted, { amount: call.amount })],
      (current) => {
        if (current.value.refundedAt) return refuse('already-refunded');
        return refundProgress(current.value).refund === 'in-doubt' ? refuse('refund-in-progress') : null;
      },
    );
    if (!started.ok) return { kind: 'write-failed', step: 'refund', failure: started.error };
    const refunded = await refundInvoice(deps.authFetch, deps.fleetId, plan.invoiceId, {
      amount: call.amount,
      note: refundNote(bookingId),
      paymentIntentPspReference: call.pspReference,
    });
    if (!refunded.ok) {
      if (!isClearRefusal(refunded.error)) return { kind: 'refund-unknown', error: refunded.error };
      const released = await mark(deps, bookingId, () => [entry(deps, EVENTS.refundReleased)], () => null);
      return { kind: 'refund-refused', error: refunded.error, releaseFailure: released.ok ? null : released.error };
    }
    recordRefund = true;
  }

  // 3. Records the refund (and marks the fee step), or marks the fee step alone.
  if (recordRefund) {
    const amount = refundCall?.amount ?? null;
    const recorded = await mark(
      deps,
      bookingId,
      () => [entry(deps, EVENTS.refunded, { amount }), ...feeMarks()],
      (current) => (current.value.refundedAt ? refuse('already-refunded') : feeTodo(current)),
      { refundedAt: deps.now().toISOString() },
    );
    if (!recorded.ok) return { kind: 'write-failed', step: 'refund', failure: recorded.error };
  } else if (feeCharge || feeSkip) {
    const marked = await mark(deps, bookingId, feeMarks, feeTodo);
    if (!marked.ok) return { kind: 'write-failed', step: 'fee', failure: marked.error };
  }
  feeSkip = false;

  const creditsMarks = (): BookingEvent[] =>
    plan.credits.kind === 'revoke'
      ? [entry(deps, EVENTS.creditsStarted, { walletId: plan.credits.walletId, balance: plan.credits.balance })]
      : [];
  let creditsMarked = false;

  // 4. The fees.
  if (feeCharge) {
    const charge = feeCharge;
    const charged = await chargeProduct(deps.authFetch, deps.fleetId, {
      productId: charge.productId,
      amount: charge.amount,
      userId: charge.userId,
      entityId: charge.entityId,
      originId: deps.userId,
      productNotes: cancellationFeeNotes(bookingId),
      bookingRequestId: bookingId,
    });
    if (!charged.ok) {
      if (!isClearRefusal(charged.error)) return { kind: 'fee-unknown', error: charged.error };
      const released = await mark(
        deps,
        bookingId,
        () => [entry(deps, EVENTS.feeReleased, { amount: charge.amount })],
        () => null,
      );
      return { kind: 'fee-refused', error: charged.error, releaseFailure: released.ok ? null : released.error };
    }
    const invoiceId = charged.data.invoiceId;
    const recorded = await mark(
      deps,
      bookingId,
      () => [entry(deps, EVENTS.feeCharged, { amount: charge.amount, invoiceId }), ...creditsMarks()],
      () => null,
    );
    if (!recorded.ok) {
      return { kind: 'fee-charged-unrecorded', invoiceId, amount: charge.amount, failure: recorded.error };
    }
    creditsMarked = true;
  }

  // 5. The credits.
  if (plan.credits.kind === 'revoke') {
    const { walletId } = plan.credits;
    if (!creditsMarked) {
      const marked = await mark(deps, bookingId, creditsMarks, (current) =>
        refundProgress(current.value).credits === 'done' ? refuse('credits-done') : null,
      );
      if (!marked.ok) return { kind: 'write-failed', step: 'credits', failure: marked.error };
    }
    const emptied = await setWalletAvailableAmount(deps.authFetch, deps.fleetId, walletId, 0);
    if (!emptied.ok) return { kind: 'credits-failed', error: emptied.error };
  }

  // 6. The end of the refund.
  const missing = amounts.missing;
  const ended = await writeOver(deps, bookingId, (current) => {
    const at = deps.now().toISOString();
    const refundedAt = current.value.refundedAt;
    if (!refundedAt) return refuse('not-refunded');
    const closing: BookingEvent[] = [
      ...(plan.credits.kind === 'revoke' ? [entry(deps, EVENTS.creditsRevoked)] : []),
      ...(plan.credits.kind === 'skip' ? [entry(deps, EVENTS.creditsSkipped)] : []),
      entry(deps, EVENTS.refundCompleted, { missingAmount: missing }),
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
  return { kind: 'done', doc: ended.value, missingAmount: missing, feeAmount: amounts.fee };
}
