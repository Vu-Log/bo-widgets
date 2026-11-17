import {
  BoError,
  type BoStorage,
  type BoStorageCollection,
  type BoStorageDocument,
  type BoStorageWhereValue,
} from '@vulog/bo-widget-sdk';
import { z } from 'zod';
import { FEE_OUTCOMES, REFUND_CALL_OUTCOMES } from './money-steps';

/*
 * The state of a Schedule a trip booking the widget keeps, in the collection `bookings` of
 * `bo.storage`, one document per booking, under the AIMA booking id. A server scheduler reads and
 * writes the same documents: this file is the contract between the two.
 *
 * - A flat object: each side only writes its own fields, with `update` (first-level merge).
 * - `schemaVersion` changes with any change of the contract.
 * - No expiry while the booking is being handled. The expiry (365 days) starts at the end of its
 *   cycle (see `startExpiry`).
 * - Every user of the host can read and write it: no secret, and no personal data beyond user ids.
 */

/** Name of the collection, in `bo.storage`. */
export const BOOKINGS_COLLECTION = 'bookings';
/** Version of the contract written in `schemaVersion`. */
export const SCHEMA_VERSION = 1;
/** Expiry set at the end of the cycle of a booking: 365 days, the most the storage takes. */
export const END_OF_CYCLE_TTL_SECONDS = 31_536_000;
/** Most entries kept in `events`: the newest. */
export const MAX_EVENTS = 50;
/** Most characters of `internalNotes` and `regularizationNote`. */
export const MAX_NOTE_LENGTH = 500;
/** Documents per page of {@link listFleetDocs}. */
export const FLEET_PAGE_SIZE = 100;
/** Bound of the pages {@link listFleetDocs} reads (10 000 documents at most per collection). */
export const MAX_FLEET_PAGES = 500;

const isoDate = z.iso.datetime({ offset: true });
const note = z.string().max(MAX_NOTE_LENGTH);

/** A warning accepted when the amount was charged. */
export const amountWarningSchema = z.enum(['above-computed', 'below-minimum']);

/** An entry of the journal of a booking. */
export const bookingEventSchema = z.looseObject({
  /** ISO date. */
  at: isoDate,
  /** Id of the user who acted (`getCurrentUser().id`), `null` for the scheduler or when unknown. */
  by: z.string().nullable(),
  /** `charge-started`, `charged`, `preallocated`, `refunded`, `regularized`… */
  type: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

/** The fees a refund left unpaid by the credits, to settle by hand. */
export const toRegularizeSchema = z.object({
  missingAmount: z.number().nonnegative(),
  at: isoDate,
});

/** ISO dates of the errors of the scheduler. */
export const schedulerErrorsSchema = z.looseObject({
  vehicleMissing: isoDate.optional(),
  enableFailed: isoDate.optional(),
  allocationFailed: isoDate.optional(),
  creditsFailed: isoDate.optional(),
});

const fields = {
  /** Fleet of the booking: several fleets share a host. Queried by the scheduler. */
  fleetId: z.string().min(1),
  /** Cache of the profile type of the customer: no prepayment nor credits for a business one. */
  isB2B: z.boolean().nullable(),
  /** Entity billed, holder of the wallet of credits. */
  entityId: z.string().min(1),
  /** Claim written with `ifVersion` before charging, against a double charge. */
  chargeStartedAt: isoDate.nullable(),
  /** Id of the operator who claimed the charge. */
  chargeStartedBy: z.string().nullable(),
  /** The prepayment invoice. */
  invoiceId: z.string().min(1).nullable(),
  /**
   * Amount charged, and so of the credits granted. Written with the charge claim, before the
   * invoice exists: credits are only due once `invoiceId` is set and the invoice is paid.
   */
  chargeAmount: z.number().positive().nullable(),
  /** Amount computed by the formula, `null` without a planned return date. */
  computedAmount: z.number().nullable(),
  /** Warnings accepted when charging. */
  amountWarnings: z.array(amountWarningSchema),
  /** Cache of the status of the invoice. */
  invoiceStatus: z.string(),
  /** ISO date of that cache. */
  invoiceStatusFetchedAt: isoDate,
  /** Vehicle put out of service for the booking. */
  preallocatedVehicleId: z.string().min(1).nullable(),
  /** Its plate. */
  preallocatedPlate: z.string().nullable(),
  internalNotes: note,
  /** Written by the scheduler: vehicle allocated, or freed after a cancellation. */
  allocationProcessed: z.boolean(),
  /** Written by the scheduler: credits granted. */
  creditsAdded: z.boolean(),
  /** Written by the scheduler: wallet of the credits. */
  walletId: z.string().min(1).nullable(),
  /** Credits set to 0 by the refund. */
  creditsRevoked: z.boolean(),
  /** ISO date of the refund: prevents a second one. */
  refundedAt: isoDate.nullable(),
  /** Fees left unpaid by a refund; kept after the regularization. */
  toRegularize: toRegularizeSchema.nullable(),
  /** `true` while a regularization is to do: what the "to regularize" filter queries. */
  regularizationPending: z.boolean(),
  regularizedAt: isoDate.nullable(),
  /** Id of the user who regularized, never an email. */
  regularizedBy: z.string().nullable(),
  regularizationNote: note.nullable(),
  /** Written by the scheduler. */
  schedulerErrors: schedulerErrorsSchema,
  /** Journal of the booking, the {@link MAX_EVENTS} newest entries: an audit trail only. */
  events: z.array(bookingEventSchema).max(MAX_EVENTS),
  // The money steps (storage/money-steps.ts): what the guards of the money actions read.
  chargeAcceptedAt: isoDate.nullable(),
  refundStartedAt: isoDate.nullable(),
  refundStartedBy: z.string().nullable(),
  refundAmount: z.number().nonnegative().nullable(),
  refundOutcome: z.enum(REFUND_CALL_OUTCOMES).nullable(),
  refundDecidedAt: isoDate.nullable(),
  refundDecidedBy: z.string().nullable(),
  feeStartedAt: isoDate.nullable(),
  feeAmount: z.number().nonnegative().nullable(),
  walletBalanceBeforeFee: z.number().nullable(),
  feeInvoiceId: z.string().min(1).nullable(),
  feeChargedAt: isoDate.nullable(),
  feeOutcome: z.enum(FEE_OUTCOMES).nullable(),
  feeDecidedAt: isoDate.nullable(),
  feeDecidedBy: z.string().nullable(),
  creditsRevocationStartedAt: isoDate.nullable(),
  creditsRevocationBalance: z.number().nullable(),
  creditsRevocationSkippedAt: isoDate.nullable(),
  refundCompletedAt: isoDate.nullable(),
};

/** The fields of the money steps, in the order of the contract. */
export const MONEY_STEP_FIELDS = [
  'chargeAcceptedAt',
  'refundStartedAt',
  'refundStartedBy',
  'refundAmount',
  'refundOutcome',
  'refundDecidedAt',
  'refundDecidedBy',
  'feeStartedAt',
  'feeAmount',
  'walletBalanceBeforeFee',
  'feeInvoiceId',
  'feeChargedAt',
  'feeOutcome',
  'feeDecidedAt',
  'feeDecidedBy',
  'creditsRevocationStartedAt',
  'creditsRevocationBalance',
  'creditsRevocationSkippedAt',
  'refundCompletedAt',
] as const;

const stateShape = {
  schemaVersion: z.literal(SCHEMA_VERSION),
  fleetId: fields.fleetId,
  allocationProcessed: fields.allocationProcessed,
  isB2B: fields.isB2B.optional(),
  entityId: fields.entityId.optional(),
  chargeStartedAt: fields.chargeStartedAt.optional(),
  chargeStartedBy: fields.chargeStartedBy.optional(),
  invoiceId: fields.invoiceId.optional(),
  chargeAmount: fields.chargeAmount.optional(),
  computedAmount: fields.computedAmount.optional(),
  amountWarnings: fields.amountWarnings.optional(),
  invoiceStatus: fields.invoiceStatus.optional(),
  invoiceStatusFetchedAt: fields.invoiceStatusFetchedAt.optional(),
  preallocatedVehicleId: fields.preallocatedVehicleId.optional(),
  preallocatedPlate: fields.preallocatedPlate.optional(),
  internalNotes: fields.internalNotes.optional(),
  creditsAdded: fields.creditsAdded.optional(),
  walletId: fields.walletId.optional(),
  creditsRevoked: fields.creditsRevoked.optional(),
  refundedAt: fields.refundedAt.optional(),
  toRegularize: fields.toRegularize.optional(),
  regularizationPending: fields.regularizationPending.optional(),
  regularizedAt: fields.regularizedAt.optional(),
  regularizedBy: fields.regularizedBy.optional(),
  regularizationNote: fields.regularizationNote.optional(),
  schedulerErrors: fields.schedulerErrors.optional(),
  events: fields.events.optional(),
  ...(Object.fromEntries(MONEY_STEP_FIELDS.map((key) => [key, fields[key].optional()])) as {
    [K in (typeof MONEY_STEP_FIELDS)[number]]: z.ZodOptional<(typeof fields)[K]>;
  }),
};

/** The known fields of a document, without the unknown ones a newer scheduler may add. */
const knownStateSchema = z.object(stateShape);

/** The value of a `bookings/{bookingId}` document (its known fields). */
export type BookingState = z.output<typeof knownStateSchema>;

/** The fields only the scheduler writes: the widget never does. */
export const SCHEDULER_FIELDS = [
  'allocationProcessed',
  'creditsAdded',
  'walletId',
  'schedulerErrors',
] as const;

/**
 * The rules between fields that protect money: an invoice only after a charge claim, a refund or
 * fees in doubt only with their start, a pending regularization only with its amount, a
 * regularization only with its author.
 */
const checkCrossFields = (state: Partial<BookingState>, context: z.RefinementCtx): void => {
  if (state.invoiceId && !state.chargeStartedAt) {
    context.addIssue({
      code: 'custom',
      path: ['invoiceId'],
      message: 'An invoice needs the charge claim (chargeStartedAt)',
    });
  }
  if (state.regularizationPending === true && !state.toRegularize) {
    context.addIssue({
      code: 'custom',
      path: ['regularizationPending'],
      message: 'A pending regularization needs its amount (toRegularize)',
    });
  }
  if (state.refundOutcome === 'in-doubt' && !state.refundStartedAt) {
    context.addIssue({
      code: 'custom',
      path: ['refundOutcome'],
      message: 'A refund in doubt needs its start (refundStartedAt)',
    });
  }
  if (state.feeOutcome === 'in-doubt' && !state.feeStartedAt) {
    context.addIssue({
      code: 'custom',
      path: ['feeOutcome'],
      message: 'Fees in doubt need their start (feeStartedAt)',
    });
  }
  if (state.regularizedAt && state.regularizedBy === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['regularizedBy'],
      message: 'A regularization needs its author (regularizedBy)',
    });
  }
};

/**
 * The value of a `bookings/{bookingId}` document, as read and as written. `schemaVersion`,
 * `fleetId` and `allocationProcessed` are always there (written on creation, so that the scheduler
 * query by equality finds the document); the others appear as the booking is handled. Unknown
 * fields (from a newer scheduler) are kept. A value that breaks a rule between fields is refused.
 */
export const bookingStateSchema = z.looseObject(stateShape).superRefine(checkCrossFields);

/**
 * A patch the widget writes: any known field but `schemaVersion` and `fleetId` (they never change)
 * and the {@link SCHEDULER_FIELDS}. An unknown field is refused.
 */
export const bookingStatePatchSchema = knownStateSchema
  .omit({
    schemaVersion: true,
    fleetId: true,
    ...(Object.fromEntries(SCHEDULER_FIELDS.map((field) => [field, true])) as Record<
      (typeof SCHEDULER_FIELDS)[number],
      true
    >),
  })
  .partial()
  .strict();

/** A first-level patch of a {@link BookingState} the widget may write. */
export type BookingStatePatch = z.input<typeof bookingStatePatchSchema>;
/** The patch that ends the cycle of a booking: it sets `refundedAt` or `regularizedAt`. */
export type EndOfCyclePatch = BookingStatePatch &
  ({ refundedAt: string } | { regularizedAt: string });
/** The patch that reopens the cycle of a booking: a regularization undone. */
export type ReopenPatch = BookingStatePatch & { regularizedAt: null };
/** An entry of `events`. */
export type BookingEvent = z.output<typeof bookingEventSchema>;
/** A warning accepted when the amount was charged. */
export type StoredAmountWarning = z.output<typeof amountWarningSchema>;

/** A stored booking state, with what `ifVersion` needs. Only built from a value that was checked. */
export interface BookingStateDoc {
  readonly id: string;
  readonly version: number;
  readonly value: BookingState;
  /** ISO date, `null` while the cycle of the booking is not over. */
  readonly expiresAt: string | null;
}

/**
 * Why a storage call failed.
 *
 * - `conflict`: written by someone else meanwhile (`version-conflict`, `already-exists`).
 * - `not-found`: the document is gone (expired, or deleted).
 * - `invalid-document`: the stored value breaks the contract (or has another `schemaVersion`).
 * - `invalid-write`: the widget was about to write a value that breaks the contract.
 * - `too-large`: the value would exceed 64 KB.
 * - `quota-exceeded`, `rate-limited` (wait before retrying, never in a loop), `forbidden` (the
 *   installation lacks the `storage` permission), `not-installed` (the widget is not installed),
 *   `unsupported` (a back office without storage).
 * - `unknown-outcome`: no answer (timeout, closed connection, network): a write may have been done;
 *   read again before writing. A connection the widget closed itself also gives `DISCONNECTED`:
 *   it is kept here, since the call may have reached the back office before.
 * - `disposed`: the back office says the widget was removed while the call was pending: ignore it.
 * - `too-many-pages`: {@link listFleetDocs} stopped at {@link MAX_FLEET_PAGES} pages.
 * - `failed`: any other refusal of the back office.
 */
export type StorageFailure =
  | { readonly kind: 'conflict' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'invalid-document'; readonly id: string; readonly issues: readonly string[] }
  | { readonly kind: 'invalid-write'; readonly issues: readonly string[] }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'quota-exceeded' }
  | { readonly kind: 'rate-limited' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'not-installed' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'unknown-outcome'; readonly error: BoError }
  | { readonly kind: 'disposed' }
  | { readonly kind: 'too-many-pages' }
  | { readonly kind: 'failed'; readonly error: BoError };

/** The outcome of a storage helper. Never throws for a refusal of the back office. */
export type StorageResult<T, F = StorageFailure> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: F };

/**
 * Why the charge claim was not written or released.
 *
 * - `already-in-progress`: a claim exists (compare `startedBy` with the operator to recognize a
 *   claim of their own, written before a lost answer).
 * - `already-charged`: an invoice exists.
 * - `conflict`: the document kept changing while claiming: try again later.
 * - any other {@link StorageFailure}.
 */
export type ClaimFailure =
  | {
      readonly kind: 'already-in-progress';
      readonly startedAt: string;
      readonly startedBy: string | null;
    }
  | { readonly kind: 'already-charged'; readonly invoiceId: string }
  | StorageFailure;

const failureDetails = (failure: StorageFailure): string => {
  switch (failure.kind) {
    case 'invalid-document':
      return `${failure.id}: ${failure.issues.join('; ')}`;
    case 'invalid-write':
      return failure.issues.join('; ');
    case 'unknown-outcome':
    case 'failed':
      return failure.error.message;
    default:
      return '';
  }
};

/** A {@link StorageFailure} thrown, for a TanStack Query `queryFn`. */
export class StorageRequestError extends Error {
  readonly failure: StorageFailure;

  constructor(failure: StorageFailure) {
    const details = failureDetails(failure);
    super(`Booking state storage: ${failure.kind}${details ? ` (${details})` : ''}`, {
      cause: 'error' in failure ? failure.error : undefined,
    });
    this.name = 'StorageRequestError';
    this.failure = failure;
  }
}

/** The `bookings` collection, typed. */
export type BookingStateCollection = BoStorageCollection<BookingState>;

const UNKNOWN_OUTCOME_REASONS = new Set(['ERR_NETWORK', 'ECONNABORTED']);

/**
 * Maps an error of a storage call to a {@link StorageFailure}, by its `code` then its `reason`.
 *
 * @param error - What the call rejected with.
 * @returns The failure.
 * @throws The error itself when it is not a `BoError`: the SDK only rejects storage calls with
 *   `BoError`, so anything else is a bug.
 */
export function mapStorageError(error: unknown): StorageFailure {
  if (!(error instanceof BoError)) throw error;
  switch (error.code) {
    case 'FORBIDDEN':
      return { kind: 'forbidden' };
    case 'TIMEOUT':
    case 'DISCONNECTED':
      return { kind: 'unknown-outcome', error };
    case 'UNKNOWN_TYPE':
      return { kind: 'unsupported' };
    case 'INTERNAL':
      break;
    default:
      return { kind: 'failed', error };
  }
  switch (error.reason) {
    case 'version-conflict':
    case 'already-exists':
      return { kind: 'conflict' };
    case 'not-found':
      return { kind: 'not-found' };
    case 'value-too-large':
      return { kind: 'too-large' };
    case 'quota-exceeded':
      return { kind: 'quota-exceeded' };
    case 'rate-limited':
      return { kind: 'rate-limited' };
    case 'not-installed':
      return { kind: 'not-installed' };
    case 'disposed':
      return { kind: 'disposed' };
    default:
      if (
        error.status === null &&
        (error.reason === null || UNKNOWN_OUTCOME_REASONS.has(error.reason))
      ) {
        return { kind: 'unknown-outcome', error };
      }
      return { kind: 'failed', error };
  }
}

const issuesOf = (error: z.ZodError): string[] =>
  error.issues.map((issue) => `${issue.path.join('.') || '(value)'}: ${issue.message}`);

type InvalidDocument = Extract<StorageFailure, { kind: 'invalid-document' }>;

const toDoc = (
  doc: BoStorageDocument<BookingState>,
): StorageResult<BookingStateDoc, InvalidDocument> => {
  const parsed = bookingStateSchema.safeParse(doc.value);
  if (!parsed.success) {
    return {
      ok: false,
      error: { kind: 'invalid-document', id: doc.id, issues: issuesOf(parsed.error) },
    };
  }
  return {
    ok: true,
    value: {
      id: doc.id,
      version: doc.version,
      value: parsed.data,
      expiresAt: doc.expiresAt ?? null,
    },
  };
};

const attempt = async (
  call: () => Promise<BoStorageDocument<BookingState>>,
): Promise<StorageResult<BookingStateDoc>> => {
  try {
    return toDoc(await call());
  } catch (error) {
    return { ok: false, error: mapStorageError(error) };
  }
};

const invalidWrite = (error: z.ZodError) =>
  ({ ok: false, error: { kind: 'invalid-write', issues: issuesOf(error) } }) as const;

/** Checks a patch alone, then the value it gives once merged into `base`. */
const checkWrite = (
  base: Record<string, unknown>,
  patch: BookingStatePatch,
): StorageResult<{ patch: BookingStatePatch; merged: BookingState }> => {
  const checkedPatch = bookingStatePatchSchema.safeParse(patch);
  if (!checkedPatch.success) return invalidWrite(checkedPatch.error);
  const merged = bookingStateSchema.safeParse({ ...base, ...checkedPatch.data });
  if (!merged.success) return invalidWrite(merged.error);
  return { ok: true, value: { patch: checkedPatch.data, merged: merged.data } };
};

/**
 * The `bookings` collection of a storage space.
 *
 * @param storage - `bo.storage` (`useBoClient().storage`).
 * @returns The typed collection.
 */
export const bookingsCollection = (storage: BoStorage): BookingStateCollection =>
  storage.collection<BookingState>(BOOKINGS_COLLECTION);

/**
 * Reads the state of a booking.
 *
 * @param collection - {@link bookingsCollection}.
 * @param bookingId - The AIMA booking id.
 * @returns The document, `null` when there is none (never written, or expired: `null` is a value to
 *   cache like any other), or why it cannot be read.
 */
export async function readBookingState(
  collection: BookingStateCollection,
  bookingId: string,
): Promise<StorageResult<BookingStateDoc | null>> {
  let doc: BoStorageDocument<BookingState> | null;
  try {
    doc = await collection.get(bookingId);
  } catch (error) {
    return { ok: false, error: mapStorageError(error) };
  }
  return doc === null ? { ok: true, value: null } : toDoc(doc);
}

/**
 * Journal entries that record a step of a money action (a charge, a refund, the fees, the
 * credits): the widget reads them back to resume an action without paying or charging twice, so
 * they are the last ones dropped when the journal is full.
 */
export const MONEY_EVENT_TYPES: ReadonlySet<string> = new Set([
  'charge-started',
  'charge-accepted',
  'charge-released',
  'charged',
  'charge-attached',
  'refund-started',
  'refund-released',
  'refund-confirmed',
  'refunded',
  'cancellation-fee-started',
  'cancellation-fee-charged',
  'cancellation-fee-released',
  'cancellation-fee-confirmed',
  'cancellation-fee-skipped',
  'credits-revocation-started',
  'credits-revocation-skipped',
  'credits-revoked',
  'refund-completed',
]);

/**
 * Appends an entry to a journal of at most {@link MAX_EVENTS} entries. A {@link MONEY_EVENT_TYPES}
 * entry is never dropped: when the journal is full, the oldest other entry is dropped; when there
 * is none, a new entry that is not a money one is dropped itself, and a new money entry is kept
 * past the limit, so that the write is refused (`invalid-write`) instead of losing a payment step.
 *
 * @param events - The current journal, if any.
 * @param event - The new entry.
 * @returns A new array, in order; `events` is not changed.
 */
export function withEvent(
  events: readonly BookingEvent[] | undefined,
  event: BookingEvent,
): BookingEvent[] {
  const all = [...(events ?? [])];
  while (all.length >= MAX_EVENTS) {
    const droppable = all.findIndex((entry) => !MONEY_EVENT_TYPES.has(entry.type));
    if (droppable === -1) break;
    all.splice(droppable, 1);
  }
  if (all.length >= MAX_EVENTS && !MONEY_EVENT_TYPES.has(event.type)) return all;
  return [...all, event];
}

/** What a new document holds besides the fields always written. */
export interface CreateBookingStateInput {
  readonly fleetId: string;
  readonly patch?: BookingStatePatch;
}

/**
 * Creates the state of a booking, only if it does not exist (`ifVersion: 0`), with
 * `allocationProcessed: false` written explicitly (the scheduler queries it by equality) and no
 * expiry. The patch is checked as an update would be.
 *
 * @param collection - {@link bookingsCollection}.
 * @param bookingId - The AIMA booking id.
 * @param input - Fleet of the booking and first fields.
 * @returns The new document, or `conflict` when it already exists.
 */
export async function createBookingState(
  collection: BookingStateCollection,
  bookingId: string,
  input: CreateBookingStateInput,
): Promise<StorageResult<BookingStateDoc>> {
  const base = {
    schemaVersion: SCHEMA_VERSION,
    fleetId: input.fleetId,
    allocationProcessed: false,
  };
  const checked = checkWrite(base, input.patch ?? {});
  if (!checked.ok) return checked;
  return attempt(() => collection.set(bookingId, checked.value.merged, { ifVersion: 0 }));
}

const writePatch = async (
  collection: BookingStateCollection,
  current: BookingStateDoc,
  patch: BookingStatePatch,
  ttlSeconds?: number | null,
): Promise<StorageResult<BookingStateDoc>> => {
  const checked = checkWrite(current.value, patch);
  if (!checked.ok) return checked;
  const options =
    ttlSeconds === undefined
      ? { ifVersion: current.version }
      : { ifVersion: current.version, ttlSeconds };
  return attempt(() => collection.update(current.id, checked.value.patch, options));
};

/**
 * Merges a patch into the state of a booking, over the version read (`ifVersion`), keeping its
 * expiry (none while the cycle is not over, and a later write never pushes the expiry back). The
 * value once merged is checked against the contract before writing.
 *
 * @param collection - {@link bookingsCollection}.
 * @param current - The document as read.
 * @param patch - First-level fields to write.
 * @returns The document written, or why it was not: `conflict` when written meanwhile (read again),
 *   `not-found` when it is gone (never recreate it).
 */
export const updateBookingState = (
  collection: BookingStateCollection,
  current: BookingStateDoc,
  patch: BookingStatePatch,
): Promise<StorageResult<BookingStateDoc>> => writePatch(collection, current, patch);

/**
 * Writes the final state of the cycle of a booking and starts its expiry: 365 days from this write.
 * Only at the end of a cycle the widget closes: a refund with nothing to regularize, or a
 * regularization.
 *
 * @param collection - {@link bookingsCollection}.
 * @param current - The document as read.
 * @param patch - The final fields, with `refundedAt` or `regularizedAt`, written in the same call.
 * @returns The document written, or why it was not.
 */
export const startExpiry = (
  collection: BookingStateCollection,
  current: BookingStateDoc,
  patch: EndOfCyclePatch,
): Promise<StorageResult<BookingStateDoc>> =>
  writePatch(collection, current, patch, END_OF_CYCLE_TTL_SECONDS);

/**
 * Writes a patch that reopens the cycle of a booking (a regularization undone) and removes its
 * expiry (`ttlSeconds: null`).
 *
 * @param collection - {@link bookingsCollection}.
 * @param current - The document as read.
 * @param patch - The fields reset, with `regularizedAt: null`, written in the same call.
 * @returns The document written, or why it was not.
 */
export const stopExpiry = (
  collection: BookingStateCollection,
  current: BookingStateDoc,
  patch: ReopenPatch,
): Promise<StorageResult<BookingStateDoc>> => writePatch(collection, current, patch, null);

/** Who claims (or releases) a charge, and when. */
export interface ClaimChargeInput {
  readonly fleetId: string;
  /** `getCurrentUser().id`, never an email. */
  readonly userId: string | null;
  readonly now: Date;
}

/** What a charge is about to bill, written with its claim (the amount is required: the search of a
 * lost invoice needs it). */
export interface ClaimPatch {
  readonly chargeAmount: number;
  readonly computedAmount: number | null;
  readonly amountWarnings: readonly StoredAmountWarning[];
  readonly entityId: string;
  readonly isB2B: boolean;
}

/** A charge claim, with what the charge is about to bill (written in the same call). */
export interface ClaimChargeWithInput extends ClaimChargeInput {
  /** Amounts and entity of the charge, written with the claim. */
  readonly patch?: ClaimPatch;
}

/** Tries of {@link claimCharge} when the document changes between its read and its write. */
const CLAIM_ATTEMPTS = 3;

const existingClaim = (current: BookingStateDoc | null): ClaimFailure | null => {
  if (current?.value.invoiceId) {
    return { kind: 'already-charged', invoiceId: current.value.invoiceId };
  }
  if (current?.value.chargeStartedAt) {
    return {
      kind: 'already-in-progress',
      startedAt: current.value.chargeStartedAt,
      startedBy: current.value.chargeStartedBy ?? null,
    };
  }
  return null;
};

/**
 * Claims the charge of a booking before creating its invoice, against a double charge (the API
 * creates one invoice per call). Writes `chargeStartedAt` and `chargeStartedBy`, and a
 * `charge-started` entry of the journal (and the amounts of `input.patch`), over the version read
 * (`ifVersion`), or only if the
 * document does not exist (`ifVersion: 0`). When the document changed meanwhile (a note, the
 * scheduler), it reads it again and checks again, {@link CLAIM_ATTEMPTS} times at most.
 *
 * @param collection - {@link bookingsCollection}.
 * @param bookingId - The AIMA booking id.
 * @param input - Fleet, operator and time of the claim.
 * @returns The claimed document; `already-charged` when an invoice exists, `already-in-progress`
 *   when a claim exists, `conflict` when the document kept changing, or a storage failure.
 */
export async function claimCharge(
  collection: BookingStateCollection,
  bookingId: string,
  input: ClaimChargeWithInput,
): Promise<StorageResult<BookingStateDoc, ClaimFailure>> {
  const at = input.now.toISOString();
  let failure: ClaimFailure = { kind: 'conflict' };
  for (let tries = 0; tries < CLAIM_ATTEMPTS && failure.kind === 'conflict'; tries++) {
    const read = await readBookingState(collection, bookingId);
    if (!read.ok) return read;
    const current = read.value;
    const claimed = existingClaim(current);
    if (claimed) return { ok: false, error: claimed };

    const billed = input.patch;
    const patch: BookingStatePatch = {
      ...(billed
        ? {
            chargeAmount: billed.chargeAmount,
            computedAmount: billed.computedAmount,
            amountWarnings: [...billed.amountWarnings],
            entityId: billed.entityId,
            isB2B: billed.isB2B,
          }
        : {}),
      chargeStartedAt: at,
      chargeStartedBy: input.userId,
      // A new claim: the acceptance of a previous one no longer applies.
      chargeAcceptedAt: null,
      events: withEvent(current?.value.events, { at, by: input.userId, type: 'charge-started' }),
    };
    const written =
      current === null
        ? await createBookingState(collection, bookingId, { fleetId: input.fleetId, patch })
        : await updateBookingState(collection, current, patch);
    if (written.ok) return written;
    failure = written.error;
  }
  return { ok: false, error: failure };
}

/**
 * Releases the charge claim of a booking, when the API refused to create its invoice (nothing was
 * charged) or once an operator checked that no invoice exists. Refused once an invoice is known.
 * The amounts written with the claim are cleared with it.
 *
 * @param collection - {@link bookingsCollection}.
 * @param current - The document as read, holding the claim.
 * @param input - Operator and time, for the journal.
 * @returns The document written; `already-charged` when it holds an invoice, or a storage failure.
 */
export async function releaseCharge(
  collection: BookingStateCollection,
  current: BookingStateDoc,
  input: Omit<ClaimChargeInput, 'fleetId'>,
): Promise<StorageResult<BookingStateDoc, ClaimFailure>> {
  if (current.value.invoiceId) {
    return { ok: false, error: { kind: 'already-charged', invoiceId: current.value.invoiceId } };
  }
  const at = input.now.toISOString();
  return updateBookingState(collection, current, {
    chargeStartedAt: null,
    chargeStartedBy: null,
    chargeAmount: null,
    computedAmount: null,
    amountWarnings: [],
    chargeAcceptedAt: null,
    events: withEvent(current.value.events, { at, by: input.userId, type: 'charge-released' }),
  });
}

/**
 * Adds an entry to the journal of a booking, over the version read, keeping the
 * {@link MAX_EVENTS} newest. To record an action, prefer passing `events: withEvent(...)` in the
 * patch of its own write: one write instead of two.
 *
 * @param collection - {@link bookingsCollection}.
 * @param bookingId - The AIMA booking id.
 * @param event - The entry.
 * @returns The document written; `not-found` when there is none, `conflict` when written meanwhile.
 */
export async function appendEvent(
  collection: BookingStateCollection,
  bookingId: string,
  event: BookingEvent,
): Promise<StorageResult<BookingStateDoc>> {
  const read = await readBookingState(collection, bookingId);
  if (!read.ok) return read;
  if (read.value === null) return { ok: false, error: { kind: 'not-found' } };
  return updateBookingState(collection, read.value, {
    events: withEvent(read.value.value.events, event),
  });
}

/** The documents of a fleet, and the ids of those that break the contract. */
export interface FleetDocs {
  readonly docs: readonly BookingStateDoc[];
  /** Documents left out because their value breaks the contract: log them, do not drop them silently. */
  readonly invalid: readonly { readonly id: string; readonly issues: readonly string[] }[];
}

/** Reads every document whose fields equal `where`, page by page, until the cursor is `null`. */
const queryAllDocs = async (
  collection: BookingStateCollection,
  where: Record<string, BoStorageWhereValue>,
): Promise<StorageResult<FleetDocs>> => {
  const docs: BookingStateDoc[] = [];
  const invalid: FleetDocs['invalid'][number][] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_FLEET_PAGES; page++) {
    let result: Awaited<ReturnType<BookingStateCollection['query']>>;
    try {
      result = await collection.query({
        where,
        limit: FLEET_PAGE_SIZE,
        ...(cursor === null ? {} : { cursor }),
      });
    } catch (error) {
      return { ok: false, error: mapStorageError(error) };
    }
    for (const item of result.items) {
      const doc = toDoc(item);
      if (doc.ok) docs.push(doc.value);
      else invalid.push({ id: doc.error.id, issues: doc.error.issues });
    }
    cursor = result.nextCursor;
    if (cursor === null) return { ok: true, value: { docs, invalid } };
  }
  return { ok: false, error: { kind: 'too-many-pages' } };
};

/**
 * Reads every booking state of a fleet: `query({ where: { fleetId } })`, by pages of
 * {@link FLEET_PAGE_SIZE}, until the cursor is `null` (a page may be empty while the cursor is not).
 * A failure of any page fails the whole listing: no partial result.
 *
 * @param collection - {@link bookingsCollection}.
 * @param fleetId - The fleet.
 * @returns The valid documents and the invalid ones, or the failure of a page (`too-many-pages`
 *   past {@link MAX_FLEET_PAGES} pages).
 */
export const listFleetDocs = (
  collection: BookingStateCollection,
  fleetId: string,
): Promise<StorageResult<FleetDocs>> => queryAllDocs(collection, { fleetId });

/**
 * The ids of the bookings of a fleet with a regularization to do:
 * `query({ where: { fleetId, regularizationPending: true } })`, by pages of {@link FLEET_PAGE_SIZE},
 * without reading every document of the fleet.
 *
 * @param collection - {@link bookingsCollection}.
 * @param fleetId - The fleet.
 * @returns The documents found (valid ones only, with the invalid ids apart), or the failure of a
 *   page.
 */
export const listPendingRegularizations = (
  collection: BookingStateCollection,
  fleetId: string,
): Promise<StorageResult<FleetDocs>> =>
  queryAllDocs(collection, { fleetId, regularizationPending: true });
