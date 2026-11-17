import {
  MAX_NOTE_LENGTH,
  type BookingStateDoc,
  type StorageResult,
} from '../../storage/booking-state';
import type { MoneyDeps } from './charge';
import { EVENTS } from './rules';
import { invalidInput, refuse, withEvents, writeOver, type WriteFailure } from './writes';

/** What the regularization writes need: storage, operator and clock. */
export type RegularizeDeps = Pick<MoneyDeps, 'collection' | 'sleep' | 'userId' | 'now'>;

/**
 * Marks the regularization of a booking as done: `regularizedAt`, `regularizedBy` (the operator id,
 * never an email), the optional note, `regularizationPending: false`, and the start of the expiry
 * (the cycle of the booking ends). `toRegularize` is kept for the history.
 *
 * @param deps - Storage, operator and clock.
 * @param bookingId - The AIMA booking id.
 * @param note - Optional comment (trimmed, at most `MAX_NOTE_LENGTH` characters).
 * @returns The document written; refused (`not-pending`, `note-too-long`) or a storage failure.
 */
export async function markRegularized(
  deps: RegularizeDeps,
  bookingId: string,
  note: string,
): Promise<StorageResult<BookingStateDoc, WriteFailure>> {
  const text = note.trim();
  if (text.length > MAX_NOTE_LENGTH) return { ok: false, error: invalidInput('too-long') };
  return writeOver(deps, bookingId, (current) => {
    if (current.value.regularizationPending !== true || !current.value.toRegularize) {
      return refuse('not-pending');
    }
    const at = deps.now().toISOString();
    return {
      mode: 'end',
      patch: {
        regularizedAt: at,
        regularizedBy: deps.userId,
        regularizationNote: text === '' ? null : text,
        regularizationPending: false,
        events: withEvents(current.value.events, [
          {
            at,
            by: deps.userId,
            type: EVENTS.regularized,
            details: { missingAmount: current.value.toRegularize.missingAmount },
          },
        ]),
      },
    };
  });
}

/**
 * Undoes a regularization recorded by mistake: the three fields back to `null`, the regularization
 * pending again, and the expiry removed (the cycle is open again).
 *
 * @param deps - Storage, operator and clock.
 * @param bookingId - The AIMA booking id.
 * @returns The document written; refused (`not-regularized`) or a storage failure.
 */
export function undoRegularization(
  deps: RegularizeDeps,
  bookingId: string,
): Promise<StorageResult<BookingStateDoc, WriteFailure>> {
  return writeOver(deps, bookingId, (current) => {
    if (!current.value.regularizedAt || !current.value.toRegularize) {
      return refuse('not-regularized');
    }
    const at = deps.now().toISOString();
    return {
      mode: 'reopen',
      patch: {
        regularizedAt: null,
        regularizedBy: null,
        regularizationNote: null,
        regularizationPending: true,
        events: withEvents(current.value.events, [
          { at, by: deps.userId, type: EVENTS.regularizationUndone },
        ]),
      },
    };
  });
}
