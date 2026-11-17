import {
  readBookingState,
  startExpiry,
  stopExpiry,
  updateBookingState,
  withEvent,
  type BookingEvent,
  type BookingStateCollection,
  type BookingStateDoc,
  type BookingStatePatch,
  type EndOfCyclePatch,
  type ReopenPatch,
  type StorageFailure,
  type StorageResult,
} from '../../storage/booking-state';

/** Tries of {@link writeOver} when the document changes between its read and its write. */
const WRITE_ATTEMPTS = 3;
/** Wait after a `rate-limited` answer, once: the storage takes about one write per second. */
export const RATE_LIMIT_WAIT_MS = 1500;

/** How a write is done: a plain update, the end of the cycle (expiry), or its reopening. */
export type WritePlan =
  | { readonly mode: 'update'; readonly patch: BookingStatePatch }
  | { readonly mode: 'end'; readonly patch: EndOfCyclePatch }
  | { readonly mode: 'reopen'; readonly patch: ReopenPatch };

/** Why a builder refused a write: the step is no longer to do on the fresh document. */
export type RefusalReason =
  | 'other-invoice'
  | 'already-refunded'
  | 'refund-in-progress'
  | 'refund-not-in-doubt'
  | 'fee-started'
  | 'fee-not-in-doubt'
  | 'credits-done'
  | 'not-refunded'
  | 'not-pending'
  | 'not-regularized'
  | 'changed';

/** A write the builder refused on the fresh document, with why. */
export interface RefusedWrite {
  readonly kind: 'refused';
  readonly reason: RefusalReason;
}

/** A value typed by the operator that breaks a limit (a note too long): nothing was read nor written. */
export interface InvalidInput {
  readonly kind: 'invalid-input';
  readonly reason: 'too-long';
}

/** Why {@link writeOver} (or a workflow around it) did not write. */
export type WriteFailure = StorageFailure | RefusedWrite | InvalidInput;

/** Builds the write from the fresh document, or refuses it (the step is no longer to do). */
export type WriteBuilder = (current: BookingStateDoc) => WritePlan | RefusedWrite;

/** What {@link writeOver} needs. */
export interface WriteDeps {
  readonly collection: BookingStateCollection;
  /** Waits before the one retry after `rate-limited`; `setTimeout` by default. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const write = (
  collection: BookingStateCollection,
  current: BookingStateDoc,
  plan: WritePlan,
): Promise<StorageResult<BookingStateDoc>> => {
  switch (plan.mode) {
    case 'update':
      return updateBookingState(collection, current, plan.patch);
    case 'end':
      return startExpiry(collection, current, plan.patch);
    case 'reopen':
      return stopExpiry(collection, current, plan.patch);
  }
};

/**
 * Reads the document of a booking and writes over the version read (`ifVersion`). The builder runs
 * on every fresh read, so a step another operator did meanwhile is refused instead of done twice.
 * On `conflict` it reads again ({@link WRITE_ATTEMPTS} tries); on `rate-limited` it waits once.
 * A missing document is `not-found`: it is never recreated.
 *
 * @param deps - Collection and sleep.
 * @param bookingId - The AIMA booking id.
 * @param build - The write, from the fresh document.
 * @returns The document written, or why it was not.
 */
export async function writeOver(
  deps: WriteDeps,
  bookingId: string,
  build: WriteBuilder,
): Promise<StorageResult<BookingStateDoc, StorageFailure | RefusedWrite>> {
  const sleep = deps.sleep ?? defaultSleep;
  let waited = false;
  let failure: StorageFailure | RefusedWrite = { kind: 'conflict' };
  for (let tries = 0; tries < WRITE_ATTEMPTS; tries++) {
    const read = await readBookingState(deps.collection, bookingId);
    if (!read.ok) return read;
    if (read.value === null) return { ok: false, error: { kind: 'not-found' } };
    const plan = build(read.value);
    if (!('mode' in plan)) return { ok: false, error: plan };
    const written = await write(deps.collection, read.value, plan);
    if (written.ok) return written;
    failure = written.error;
    if (failure.kind === 'rate-limited' && !waited) {
      waited = true;
      await sleep(RATE_LIMIT_WAIT_MS);
      continue;
    }
    if (failure.kind !== 'conflict') return { ok: false, error: failure };
  }
  return { ok: false, error: failure };
}

/**
 * Appends several entries to a journal, in order, keeping the newest.
 *
 * @param events - The current journal.
 * @param added - The entries to add.
 * @returns A new array.
 */
export const withEvents = (
  events: readonly BookingEvent[] | undefined,
  added: readonly BookingEvent[],
): BookingEvent[] => added.reduce<BookingEvent[]>((all, event) => withEvent(all, event), [
  ...(events ?? []),
]);

/**
 * A refusal of a builder.
 *
 * @param reason - Why the step is no longer to do.
 * @returns The refusal.
 */
export const refuse = (reason: RefusalReason): RefusedWrite => ({ kind: 'refused', reason });

/**
 * A value typed by the operator that breaks a limit.
 *
 * @param reason - The limit broken.
 * @returns The failure.
 */
export const invalidInput = (reason: InvalidInput['reason']): InvalidInput => ({
  kind: 'invalid-input',
  reason,
});
