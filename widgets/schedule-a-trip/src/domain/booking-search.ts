/** What {@link matchesSearch} compares the query with. */
export interface SearchableBooking {
  readonly bookingId: string;
  /** Names and user name of the customer, when loaded. */
  readonly customerTexts: readonly (string | null)[];
  /** Plate of the vehicle, when known. */
  readonly plate: string | null;
}

/**
 * A text without case, accents nor spaces, to compare a search with.
 *
 * @param value - Any text.
 * @returns The folded text.
 */
export const foldText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[\s._-]+/g, '')
    .toLowerCase();

/**
 * Whether a booking matches the search of the list: each word of the query is found in the
 * booking id, the plate, or the names of the customer. A blank query matches everything.
 *
 * @param query - What the operator typed.
 * @param booking - What to search in.
 * @returns `true` when every word is found.
 */
export function matchesSearch(query: string, booking: SearchableBooking): boolean {
  const words = query.split(/\s+/).map(foldText).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [booking.bookingId, booking.plate, ...booking.customerTexts]
    .flatMap((value) => (value ? [foldText(value)] : []))
    .join('\n');
  return words.every((word) => haystack.includes(word));
}
