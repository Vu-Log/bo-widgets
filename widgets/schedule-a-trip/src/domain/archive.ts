import { differenceInDays } from 'date-fns';

/** The stored state of a booking expires at most this many days after the end of its cycle. */
export const ARCHIVE_AFTER_DAYS = 365;

/** What {@link lastActivity} reads of a booking. */
export interface ActivityDates {
  readonly startDate: string;
  readonly endDate: string | null;
  readonly plannedReturnDate: string | null;
  readonly cancellationDate: string | null;
}

/**
 * The last activity of a booking: the latest of its return (real or planned), cancellation and
 * start dates.
 *
 * @param booking - The dates of the booking.
 * @returns The date.
 */
export function lastActivity(booking: ActivityDates): Date {
  const times = [booking.startDate, booking.endDate, booking.plannedReturnDate, booking.cancellationDate]
    .flatMap((value) => (value === null ? [] : [Date.parse(value)]))
    .filter((time) => !Number.isNaN(time));
  return new Date(Math.max(...times));
}

/**
 * What the widget knows of the stored state of a booking:
 *
 * - `loading`: not read yet;
 * - `present`: a document exists;
 * - `none`: no document, the widget never wrote for this booking;
 * - `archived`: no document and the last activity is more than {@link ARCHIVE_AFTER_DAYS} days ago:
 *   it may have expired. Read only: no action of the widget.
 *
 * @param booking - The dates of the booking.
 * @param state - The stored document: `undefined` while loading, `null` when there is none.
 * @param now - The current time.
 * @returns The status.
 */
export function storedDataStatus(
  booking: ActivityDates,
  state: object | null | undefined,
  now: Date,
): 'loading' | 'present' | 'none' | 'archived' {
  if (state === undefined) return 'loading';
  if (state !== null) return 'present';
  return differenceInDays(now, lastActivity(booking)) > ARCHIVE_AFTER_DAYS ? 'archived' : 'none';
}
