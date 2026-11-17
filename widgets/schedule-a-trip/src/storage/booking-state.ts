import {
  BoError,
  type BoStorage,
  type BoStorageCollection,
  type BoStorageDocument,
} from '@vulog/bo-widget-sdk';
import { z } from 'zod';

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
  /** Amount charged, and so of the credits granted. */
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
  /** Journal of the booking, the {@link MAX_EVENTS} newest entries. */
  events: z.array(bookingEventSchema).max(MAX_EVENTS),
};

/**
 * The value of a `bookings/{bookingId}` document. `schemaVersion`, `fleetId` and
 * `allocationProcessed` are always there (written on creation, so that the scheduler query by
 * equality finds the document); the others appear as the booking is handled. Unknown fields (from a
 * newer scheduler) are kept.
 */
export const bookingStateSchema = z.looseObject({
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
});

/** A patch of a document: any field but `schemaVersion` and `fleetId`, which never change. */
export const bookingStatePatchSchema = bookingStateSchema
  .omit({ schemaVersion: true, fleetId: true })
  .partial()
  .strict();

/** The value of a `bookings/{bookingId}` document. */
export type BookingState = z.output<typeof bookingStateSchema>;
/** A first-level patch of a {@link BookingState}. */
export type BookingStatePatch = z.input<typeof bookingStatePatchSchema>;
/** An entry of `events`. */
export type BookingEvent = z.output<typeof bookingEventSchema>;
/** A warning accepted when the amount was charged. */
export type StoredAmountWarning = z.output<typeof amountWarningSchema>;

/** A stored booking state, with what `ifVersion` needs. */
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
 * - `quota-exceeded`, `rate-limited` (wait before retrying, never in a loop), `forbidden` (the
 *   installation lacks the `storage` permission).
 * - `unknown-outcome`: no answer (timeout, connection closed, network): a write may have been done;
 *   read again before writing.
 * - `disposed`: the widget was removed while the call was pending: ignore it.
 * - `failed`: any other refusal of the back office.
 */
export type StorageFailure =
  | { readonly kind: 'conflict' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'invalid-document'; readonly id: string; readonly issues: readonly string[] }
  | { readonly kind: 'invalid-write'; readonly issues: readonly string[] }
  | { readonly kind: 'quota-exceeded' }
  | { readonly kind: 'rate-limited' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'unknown-outcome'; readonly error: BoError }
  | { readonly kind: 'disposed' }
  | { readonly kind: 'failed'; readonly error: BoError | Error };

/** The outcome of a storage helper. Never throws for a refusal of the back office. */
export type StorageResult<T, F = StorageFailure> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: F };

/** Why {@link claimCharge} did not claim: another charge is (or was) under way, or a storage failure. */
export type ClaimFailure =
  { readonly kind: 'already-in-progress' } | { readonly kind: 'already-charged' } | StorageFailure;

/** A {@link StorageFailure} thrown, for a TanStack Query `queryFn`. */
export class StorageRequestError extends Error {
  readonly failure: StorageFailure;

  constructor(failure: StorageFailure) {
    super(`Booking state storage: ${failure.kind}`);
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
      return { kind: 'unknown-outcome', error };
    case 'DISCONNECTED':
      return { kind: 'unknown-outcome', error };
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
    case 'quota-exceeded':
      return { kind: 'quota-exceeded' };
    case 'rate-limited':
      return { kind: 'rate-limited' };
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

const checkPatch = (patch: BookingStatePatch): StorageResult<BookingStatePatch> => {
  const parsed = bookingStatePatchSchema.safeParse(patch);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: { kind: 'invalid-write', issues: issuesOf(parsed.error) } };
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
 * Appends an entry to a journal, keeping the {@link MAX_EVENTS} newest.
 *
 * @param events - The current journal, if any.
 * @param event - The new entry.
 * @returns A new array; `events` is not changed.
 */
export const withEvent = (
  events: readonly BookingEvent[] | undefined,
  event: BookingEvent,
): BookingEvent[] => [...(events ?? []), event].slice(-MAX_EVENTS);

/** What a new document holds besides the fields always written. */
export interface CreateBookingStateInput {
  readonly fleetId: string;
  readonly patch?: BookingStatePatch;
}

/**
 * Creates the state of a booking, only if it does not exist (`ifVersion: 0`), with
 * `allocationProcessed: false` written explicitly (the scheduler queries it by equality) and no
 * expiry.
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
  const value = bookingStateSchema.safeParse({
    allocationProcessed: false,
    ...input.patch,
    schemaVersion: SCHEMA_VERSION,
    fleetId: input.fleetId,
  });
  if (!value.success) {
    return { ok: false, error: { kind: 'invalid-write', issues: issuesOf(value.error) } };
  }
  return attempt(() => collection.set(bookingId, value.data, { ifVersion: 0 }));
}

/** Options of the writes of an existing document. */
export interface UpdateOptions {
  /** Writes only over this version (`conflict` otherwise). */
  readonly ifVersion?: number;
}

const writePatch = async (
  collection: BookingStateCollection,
  bookingId: string,
  patch: BookingStatePatch,
  options: UpdateOptions & { ttlSeconds?: number | null },
): Promise<StorageResult<BookingStateDoc>> => {
  const checked = checkPatch(patch);
  if (!checked.ok) return checked;
  return attempt(() => collection.update(bookingId, checked.value, options));
};

/**
 * Merges a patch into the state of a booking, keeping its expiry (none while the cycle is not over,
 * and a later write never pushes the expiry back).
 *
 * @param collection - {@link bookingsCollection}.
 * @param bookingId - The AIMA booking id.
 * @param patch - First-level fields to write.
 * @param options - `ifVersion`.
 * @returns The document written, or why it was not (`not-found` when it is gone: never recreate it).
 */
export const updateBookingState = (
  collection: BookingStateCollection,
  bookingId: string,
  patch: BookingStatePatch,
  options: UpdateOptions = {},
): Promise<StorageResult<BookingStateDoc>> => writePatch(collection, bookingId, patch, options);

/**
 * Writes the final state of the cycle of a booking and starts its expiry: 365 days from this write.
 * Only at the end of a cycle the widget closes: a refund with nothing to regularize, or a
 * regularization.
 *
 * @param collection - {@link bookingsCollection}.
 * @param bookingId - The AIMA booking id.
 * @param patch - The final fields (`refundedAt`, `regularizedAt`…), written in the same call.
 * @param options - `ifVersion`.
 * @returns The document written, or why it was not.
 */
export const startExpiry = (
  collection: BookingStateCollection,
  bookingId: string,
  patch: BookingStatePatch,
  options: UpdateOptions = {},
): Promise<StorageResult<BookingStateDoc>> =>
  writePatch(collection, bookingId, patch, { ...options, ttlSeconds: END_OF_CYCLE_TTL_SECONDS });

/**
 * Writes a patch that reopens the cycle of a booking (a regularization undone) and removes its
 * expiry (`ttlSeconds: null`).
 *
 * @param collection - {@link bookingsCollection}.
 * @param bookingId - The AIMA booking id.
 * @param patch - The fields reset (`regularizedAt: null`…), written in the same call.
 * @param options - `ifVersion`.
 * @returns The document written, or why it was not.
 */
export const stopExpiry = (
  collection: BookingStateCollection,
  bookingId: string,
  patch: BookingStatePatch,
  options: UpdateOptions = {},
): Promise<StorageResult<BookingStateDoc>> =>
  writePatch(collection, bookingId, patch, { ...options, ttlSeconds: null });

/** Who claims a charge, and when. */
export interface ClaimChargeInput {
  readonly fleetId: string;
  /** `getCurrentUser().id`, never an email. */
  readonly userId: string | null;
  readonly now: Date;
}

const claimFailure = (failure: StorageFailure): ClaimFailure =>
  failure.kind === 'conflict' ? { kind: 'already-in-progress' } : failure;

/**
 * Claims the charge of a booking before creating its invoice, against a double charge (the API
 * creates one invoice per call). Writes `chargeStartedAt` and `chargeStartedBy`, and a
 * `charge-started` entry of the journal, over the version read (`ifVersion`), or only if the
 * document does not exist (`ifVersion: 0`).
 *
 * @param collection - {@link bookingsCollection}.
 * @param bookingId - The AIMA booking id.
 * @param input - Fleet, operator and time of the claim.
 * @returns The claimed document; `already-charged` when an invoice exists, `already-in-progress`
 *   when a claim exists or another operator wrote meanwhile, or a storage failure.
 */
export async function claimCharge(
  collection: BookingStateCollection,
  bookingId: string,
  input: ClaimChargeInput,
): Promise<StorageResult<BookingStateDoc, ClaimFailure>> {
  const read = await readBookingState(collection, bookingId);
  if (!read.ok) return read;
  const current = read.value;
  if (current?.value.invoiceId) return { ok: false, error: { kind: 'already-charged' } };
  if (current?.value.chargeStartedAt) return { ok: false, error: { kind: 'already-in-progress' } };

  const at = input.now.toISOString();
  const patch: BookingStatePatch = {
    chargeStartedAt: at,
    chargeStartedBy: input.userId,
    events: withEvent(current?.value.events, { at, by: input.userId, type: 'charge-started' }),
  };
  const written =
    current === null
      ? await createBookingState(collection, bookingId, { fleetId: input.fleetId, patch })
      : await updateBookingState(collection, bookingId, patch, { ifVersion: current.version });
  return written.ok ? written : { ok: false, error: claimFailure(written.error) };
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
  return updateBookingState(
    collection,
    bookingId,
    { events: withEvent(read.value.value.events, event) },
    { ifVersion: read.value.version },
  );
}

/** The documents of a fleet, and the ids of those that break the contract. */
export interface FleetDocs {
  readonly docs: readonly BookingStateDoc[];
  /** Documents left out: their value breaks the contract. */
  readonly invalid: readonly { readonly id: string; readonly issues: readonly string[] }[];
}

/**
 * Reads every booking state of a fleet: `query({ where: { fleetId } })`, by pages of
 * {@link FLEET_PAGE_SIZE}, until the cursor is `null` (a page may be empty while the cursor is not).
 *
 * @param collection - {@link bookingsCollection}.
 * @param fleetId - The fleet.
 * @returns The valid documents and the invalid ones, or the failure of a page (`failed` past
 *   {@link MAX_FLEET_PAGES} pages).
 */
export async function listFleetDocs(
  collection: BookingStateCollection,
  fleetId: string,
): Promise<StorageResult<FleetDocs>> {
  const docs: BookingStateDoc[] = [];
  const invalid: FleetDocs['invalid'][number][] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_FLEET_PAGES; page++) {
    let result: Awaited<ReturnType<BookingStateCollection['query']>>;
    try {
      result = await collection.query({
        where: { fleetId },
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
  return {
    ok: false,
    error: {
      kind: 'failed',
      error: new Error(`More than ${MAX_FLEET_PAGES} pages of booking states`),
    },
  };
}
