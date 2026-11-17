import {
  createBookingState,
  MAX_NOTE_LENGTH,
  type BookingStateDoc,
  type StorageResult,
} from '../../storage/booking-state';
import type { MoneyDeps } from './charge';
import { EVENTS } from './rules';
import { refuse, withEvents, writeOver, type WriteFailure } from './writes';

/** What saving a note needs: storage, fleet, operator and clock. */
export type NotesDeps = Pick<MoneyDeps, 'collection' | 'sleep' | 'fleetId' | 'userId' | 'now'>;

/**
 * Saves the internal notes of a booking (at most `MAX_NOTE_LENGTH` characters; empty clears them),
 * with a journal entry. Creates the document when the widget never wrote for this booking
 * (`existed: false`); a document that disappears while it is edited is `not-found`, never
 * recreated.
 *
 * @param deps - Storage, fleet, operator and clock.
 * @param bookingId - The AIMA booking id.
 * @param notes - The new notes.
 * @param existed - Whether the document existed when the operator opened the notes.
 * @returns The document written; refused (`too-long`) or a storage failure.
 */
export async function saveInternalNotes(
  deps: NotesDeps,
  bookingId: string,
  notes: string,
  existed: boolean,
): Promise<StorageResult<BookingStateDoc, WriteFailure>> {
  if (notes.length > MAX_NOTE_LENGTH) return { ok: false, error: refuse('too-long') };
  const entry = () => ({
    at: deps.now().toISOString(),
    by: deps.userId,
    type: EVENTS.notesSaved,
    details: { length: notes.length },
  });
  if (!existed) {
    const created = await createBookingState(deps.collection, bookingId, {
      fleetId: deps.fleetId,
      patch: { internalNotes: notes, events: [entry()] },
    });
    // Created meanwhile (another operator, a charge): write over it as an update.
    if (created.ok || created.error.kind !== 'conflict') return created;
  }
  return writeOver(deps, bookingId, (current) => ({
    mode: 'update',
    patch: { internalNotes: notes, events: withEvents(current.value.events, [entry()]) },
  }));
}
