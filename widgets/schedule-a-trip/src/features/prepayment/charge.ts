import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { chargeProduct, listBilledInvoices, type BilledInvoice } from '../../api/billing';
import type { ApiError } from '../../api/http';
import type { ScheduledBooking } from '../../api/schedule-a-trip';
import {
  estimateDuration,
  type AmountWarning,
  type ChargeSettings,
} from '../../domain/charge-amount';
import {
  claimCharge,
  readBookingState,
  releaseCharge,
  type BookingStateDoc,
  type ClaimFailure,
  type StorageResult,
} from '../../storage/booking-state';
import {
  canUnlockClaim,
  EVENTS,
  invoiceSearchRange,
  isClearRefusal,
  matchPrepaymentInvoices,
  prepaymentNotes,
} from './rules';
import { refuse, withEvents, writeOver, type WriteDeps, type WriteFailure } from './writes';

/** What the money workflows need: the API, the storage, the fleet, the operator and the clock. */
export interface MoneyDeps extends WriteDeps {
  readonly authFetch: AuthFetch;
  readonly fleetId: string;
  /** `getCurrentUser().id`: written as the author, and as the `originId` of an invoice. */
  readonly userId: string;
  readonly now: () => Date;
}

/** A prepayment to charge, as the operator confirmed it. */
export interface ChargeRequest {
  readonly booking: Pick<ScheduledBooking, 'id' | 'userId'>;
  /** Entity of the profile of the booking (`prepaymentEligibility`). */
  readonly entityId: string;
  readonly amount: number;
  readonly computedAmount: number | null;
  /** Warnings the operator accepted. */
  readonly warnings: readonly AmountWarning[];
  /** `prepaymentProductId` of the settings. */
  readonly productId: string;
  readonly settings: ChargeSettings;
}

/**
 * The outcome of a charge.
 *
 * - `charged`: the invoice is created and recorded.
 * - `charged-unrecorded`: the invoice is created, but the document could not be updated: the claim
 *   stays, the booking shows "to verify" and the search finds the invoice.
 * - `refused`: the API refused the invoice (nothing billed); the claim is released, or not
 *   (`releaseFailure`, the booking then shows "to verify").
 * - `to-verify`: the outcome is unknown (lost answer, 5xx, unreadable answer): an invoice may
 *   exist. The claim stays.
 * - `not-claimed`: the claim was refused (already charged, in progress, storage failure): nothing
 *   was sent to the API.
 * - `invalid`: the request breaks a rule (amount, customer); nothing was written.
 */
export type ChargeOutcome =
  | { readonly kind: 'charged'; readonly doc: BookingStateDoc; readonly invoiceId: string }
  | {
      readonly kind: 'charged-unrecorded';
      readonly invoiceId: string;
      readonly failure: WriteFailure;
    }
  | {
      readonly kind: 'refused';
      readonly error: ApiError;
      readonly doc: BookingStateDoc | null;
      readonly releaseFailure: ClaimFailure | null;
    }
  | { readonly kind: 'to-verify'; readonly error: ApiError | null }
  | { readonly kind: 'not-claimed'; readonly failure: ClaimFailure }
  | { readonly kind: 'invalid'; readonly reason: 'amount' | 'customer' };

/** Tries of a release when the document changes meanwhile. */
const RELEASE_ATTEMPTS = 3;

/**
 * Releases the claim of the operator, only while it is still theirs (same date) and no invoice is
 * known, reading the document again after a conflict.
 */
async function releaseOwnClaim(
  deps: MoneyDeps,
  bookingId: string,
  claimedAt: string,
): Promise<StorageResult<BookingStateDoc, ClaimFailure>> {
  let failure: ClaimFailure = { kind: 'conflict' };
  for (let tries = 0; tries < RELEASE_ATTEMPTS && failure.kind === 'conflict'; tries++) {
    const read = await readBookingState(deps.collection, bookingId);
    if (!read.ok) return read;
    if (read.value === null) return { ok: false, error: { kind: 'not-found' } };
    if (read.value.value.chargeStartedAt !== claimedAt) {
      return {
        ok: false,
        error: {
          kind: 'already-in-progress',
          startedAt: read.value.value.chargeStartedAt ?? '',
          startedBy: read.value.value.chargeStartedBy ?? null,
        },
      };
    }
    const released = await releaseCharge(deps.collection, read.value, {
      userId: deps.userId,
      now: deps.now(),
    });
    if (released.ok) return released;
    failure = released.error;
  }
  return { ok: false, error: failure };
}

/**
 * Charges the prepayment of a booking, against a double charge:
 *
 * 1. claims the charge (`ifVersion`), writing the amounts and the entity with the claim;
 * 2. only then creates the invoice (`productNotes` names the booking and the hours paid,
 *    `originId` is the operator);
 * 3. records the invoice; or, on a clear refusal of the API, releases the claim; or, when the
 *    outcome is unknown, keeps the claim ("to verify").
 *
 * @param deps - API, storage, fleet, operator and clock.
 * @param request - Booking, entity, amounts and product.
 * @returns The outcome; never throws for a failure of the API or the storage.
 */
export async function chargePrepayment(
  deps: MoneyDeps,
  request: ChargeRequest,
): Promise<ChargeOutcome> {
  const duration = estimateDuration(request.amount, request.settings);
  if (duration === null) return { kind: 'invalid', reason: 'amount' };
  const customerId = request.booking.userId;
  if (!customerId) return { kind: 'invalid', reason: 'customer' };
  const bookingId = request.booking.id;

  const claimed = await claimCharge(deps.collection, bookingId, {
    fleetId: deps.fleetId,
    userId: deps.userId,
    now: deps.now(),
    patch: {
      chargeAmount: request.amount,
      computedAmount: request.computedAmount,
      amountWarnings: [...request.warnings],
      entityId: request.entityId,
      isB2B: false,
    },
  });
  if (!claimed.ok) return { kind: 'not-claimed', failure: claimed.error };
  const claimedAt = claimed.value.value.chargeStartedAt ?? '';

  const charged = await chargeProduct(deps.authFetch, deps.fleetId, {
    productId: request.productId,
    amount: request.amount,
    userId: customerId,
    entityId: request.entityId,
    originId: deps.userId,
    productNotes: prepaymentNotes(bookingId, duration.totalHours),
  });
  if (!charged.ok) {
    if (!isClearRefusal(charged.error)) return { kind: 'to-verify', error: charged.error };
    const released = await releaseOwnClaim(deps, bookingId, claimedAt);
    return {
      kind: 'refused',
      error: charged.error,
      doc: released.ok ? released.value : null,
      releaseFailure: released.ok ? null : released.error,
    };
  }
  const { invoiceId, status } = charged.data;
  if (invoiceId === null) return { kind: 'to-verify', error: null };

  const recorded = await recordInvoice(deps, bookingId, invoiceId, status, EVENTS.charged, {
    amount: request.amount,
  });
  if (!recorded.ok) return { kind: 'charged-unrecorded', invoiceId, failure: recorded.error };
  return { kind: 'charged', doc: recorded.value, invoiceId };
}

/** Writes the invoice of a claim, refusing when another invoice was recorded meanwhile. */
function recordInvoice(
  deps: MoneyDeps,
  bookingId: string,
  invoiceId: string,
  status: string | null,
  eventType: string,
  details: Record<string, unknown>,
): Promise<StorageResult<BookingStateDoc, WriteFailure>> {
  return writeOver(deps, bookingId, (current) => {
    const value = current.value;
    if (value.invoiceId && value.invoiceId !== invoiceId) return refuse('other-invoice');
    if (!value.chargeStartedAt) return refuse('no-claim');
    const at = deps.now().toISOString();
    return {
      mode: 'update',
      patch: {
        invoiceId,
        ...(status === null ? {} : { invoiceStatus: status, invoiceStatusFetchedAt: at }),
        events: withEvents(value.events, [
          { at, by: deps.userId, type: eventType, details: { invoiceId, ...details } },
        ]),
      },
    };
  });
}

/** Invoices per page of the search. */
const SEARCH_PAGE_SIZE = 100;
/** Pages read at most: past them the search is `incomplete`, never "none found". */
const SEARCH_MAX_PAGES = 20;

/**
 * The outcome of the search of a claimed invoice.
 *
 * - `found`: the invoices matching (one, or several when the customer was charged twice).
 * - `none`: every page was read, nothing matches.
 * - `incomplete`: too many invoices to read them all: not a proof that none exists.
 * - `failed`: the API failed: not a proof either.
 * - `invalid`: the document has no claim, amount or customer to search with.
 */
export type SearchOutcome =
  | { readonly kind: 'found'; readonly invoices: readonly BilledInvoice[] }
  | { readonly kind: 'none' }
  | { readonly kind: 'incomplete' }
  | { readonly kind: 'failed'; readonly error: ApiError }
  | { readonly kind: 'invalid' };

/**
 * Searches the invoice of a charge whose answer was lost: the invoices created since the claim
 * (minus a clock margin), with the exact amount charged, then those of the customer, the product
 * and with notes naming the booking. Reads every page before saying none was found.
 *
 * @param deps - API, fleet and clock.
 * @param input - The booking, its document and the prepayment product.
 * @returns The matches, or why there is no answer.
 */
export async function searchClaimedInvoice(
  deps: Pick<MoneyDeps, 'authFetch' | 'fleetId' | 'now'>,
  input: {
    readonly booking: Pick<ScheduledBooking, 'id' | 'userId'>;
    readonly doc: BookingStateDoc;
    readonly productId: string;
  },
): Promise<SearchOutcome> {
  const { chargeStartedAt, chargeAmount } = input.doc.value;
  if (!chargeStartedAt || !chargeAmount || !input.booking.userId) return { kind: 'invalid' };
  const range = invoiceSearchRange(chargeStartedAt, deps.now());
  const found: BilledInvoice[] = [];
  for (let page = 0; page < SEARCH_MAX_PAGES; page++) {
    const result = await listBilledInvoices(deps.authFetch, deps.fleetId, {
      ...range,
      minAmount: chargeAmount,
      maxAmount: chargeAmount,
      page,
      size: SEARCH_PAGE_SIZE,
    });
    if (!result.ok) return { kind: 'failed', error: result.error };
    found.push(
      ...matchPrepaymentInvoices(result.data, {
        bookingId: input.booking.id,
        userId: input.booking.userId,
        productId: input.productId,
        amount: chargeAmount,
      }),
    );
    if (result.data.length < SEARCH_PAGE_SIZE) {
      const unique = [...new Map(found.map((invoice) => [invoice.id, invoice])).values()];
      return unique.length > 0 ? { kind: 'found', invoices: unique } : { kind: 'none' };
    }
  }
  return { kind: 'incomplete' };
}

/**
 * Records an invoice the search found as the prepayment of the booking.
 *
 * @param deps - Storage, operator and clock.
 * @param bookingId - The AIMA booking id.
 * @param invoice - The invoice found.
 * @returns The document written; refused (`other-invoice`, `no-claim`) when the document changed.
 */
export const attachInvoice = (
  deps: MoneyDeps,
  bookingId: string,
  invoice: BilledInvoice,
): Promise<StorageResult<BookingStateDoc, WriteFailure>> =>
  recordInvoice(deps, bookingId, invoice.id, invoice.status, EVENTS.chargeAttached, {
    amount: invoice.amount,
  });

/** Why an unlock was refused. */
export type UnlockFailure = ClaimFailure | { readonly kind: 'too-recent' } | { readonly kind: 'no-claim' };

/**
 * Releases a claim once an operator checked that no invoice exists ("no invoice found, unlock"):
 * only for a claim without an invoice, at least `UNLOCK_MIN_CLAIM_AGE_MINUTES` old.
 *
 * @param deps - Storage, operator and clock.
 * @param bookingId - The AIMA booking id.
 * @returns The document released, or why not.
 */
export async function unlockClaim(
  deps: MoneyDeps,
  bookingId: string,
): Promise<StorageResult<BookingStateDoc, UnlockFailure>> {
  const read = await readBookingState(deps.collection, bookingId);
  if (!read.ok) return read;
  const claimedAt = read.value?.value.chargeStartedAt;
  if (!read.value || !claimedAt) return { ok: false, error: { kind: 'no-claim' } };
  if (read.value.value.invoiceId) {
    return { ok: false, error: { kind: 'already-charged', invoiceId: read.value.value.invoiceId } };
  }
  if (!canUnlockClaim(claimedAt, deps.now())) return { ok: false, error: { kind: 'too-recent' } };
  return releaseOwnClaim(deps, bookingId, claimedAt);
}
