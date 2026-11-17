import {
  createBookingState,
  MAX_NOTE_LENGTH,
  type BookingStateDoc,
  type StorageResult,
} from '../../storage/booking-state';
import type { MoneyDeps } from './charge';
import { EVENTS } from './rules';
import { invalidInput, refuse, withEvents, writeOver, type WriteFailure } from './writes';

/** What saving a note needs: storage, fleet, operator and clock. */
export type NotesDeps = Pick<MoneyDeps, 'collection' | 'sleep' | 'fleetId' | 'userId' | 'now'>;

/**
 * Saves the internal notes of a booking (at most `MAX_NOTE_LENGTH` characters; empty clears them),
 * with a journal entry. Creates the document when the widget never wrote for this booking
 * (`previous: null`); a document that disappears while it is edited is `not-found`, never
 * recreated. Notes changed by someone else since the operator opened them are not overwritten.
 *
 * @param deps - Storage, fleet, operator and clock.
 * @param bookingId - The AIMA booking id.
 * @param notes - The new notes.
 * @param previous - The notes the operator started from, `null` when there was no document.
 * @returns The document written; `invalid-input` (too long), refused (`changed`) or a storage
 *   failure.
 */
export async function saveInternalNotes(
  deps: NotesDeps,
  bookingId: string,
  notes: string,
  previous: string | null,
): Promise<StorageResult<BookingStateDoc, WriteFailure>> {
  if (notes.length > MAX_NOTE_LENGTH) return { ok: false, error: invalidInput('too-long') };
  const entry = () => ({
    at: deps.now().toISOString(),
    by: deps.userId,
    type: EVENTS.notesSaved,
    details: { length: notes.length },
  });
  if (previous === null) {
    const created = await createBookingState(deps.collection, bookingId, {
      fleetId: deps.fleetId,
      patch: { internalNotes: notes, events: [entry()] },
    });
    // Created meanwhile (another operator, a charge): write over it, if it holds no notes.
    if (created.ok || created.error.kind !== 'conflict') return created;
  }
  return writeOver(deps, bookingId, (current) => {
    if ((current.value.internalNotes ?? '') !== (previous ?? '')) return refuse('changed');
    return {
      mode: 'update',
      patch: { internalNotes: notes, events: withEvents(current.value.events, [entry()]) },
    };
  });
}
