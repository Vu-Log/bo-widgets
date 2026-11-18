import { addMinutes, differenceInMinutes } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/** Default length of a new booking, in minutes, as in the back office. */
export const DEFAULT_DURATION_MINUTES = 120;
const QUARTER_MS = 15 * 60_000;

/**
 * The default start of a new booking: the next quarter of an hour.
 *
 * @param now - The current time.
 * @returns The start.
 */
export const defaultStart = (now: Date): Date =>
  new Date(Math.ceil((now.getTime() + 1) / QUARTER_MS) * QUARTER_MS);

/**
 * The default planned return of a new booking: {@link DEFAULT_DURATION_MINUTES} after its start.
 *
 * @param start - The start.
 * @returns The planned return.
 */
export const defaultReturn = (start: Date): Date => addMinutes(start, DEFAULT_DURATION_MINUTES);

/**
 * A date as the value of an `<input type="datetime-local">` in a time zone (`2026-03-10T09:00`).
 *
 * @param date - The date.
 * @param timeZone - The zone of the fleet; the browser's when `null`.
 * @returns The value.
 */
export const toZonedInput = (date: Date, timeZone: string | null): string =>
  formatInTimeZone(date, timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, "yyyy-MM-dd'T'HH:mm");

/**
 * The date of an `<input type="datetime-local">` value read in a time zone.
 *
 * @param value - `2026-03-10T09:00`, or `''`.
 * @param timeZone - The zone of the fleet; the browser's when `null`.
 * @returns The date, `null` for an empty or unreadable value.
 */
export function fromZonedInput(value: string, timeZone: string | null): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = fromZonedTime(value, timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Why the dates of a booking are refused. */
export type DatesProblem = 'start-missing' | 'start-past' | 'return-before-start';

/**
 * Checks the dates of a booking: a start, in the future, and a planned return (optional) after it.
 *
 * @param input - Start and planned return (`null` when empty), and the current time.
 * @returns The problems, none when the dates can be sent.
 */
export function datesProblems(input: {
  readonly start: Date | null;
  readonly plannedReturn: Date | null;
  readonly now: Date;
}): DatesProblem[] {
  if (input.start === null) return ['start-missing'];
  const problems: DatesProblem[] = [];
  if (input.start.getTime() <= input.now.getTime()) problems.push('start-past');
  if (input.plannedReturn !== null && differenceInMinutes(input.plannedReturn, input.start) <= 0) {
    problems.push('return-before-start');
  }
  return problems;
}

/** A pickup point that can be sent: coordinates in range and a valid radius. */
export interface Pickup {
  readonly latitude: number;
  readonly longitude: number;
  /** In meters. */
  readonly radius: number;
}

/**
 * A pickup point being typed, checked: both coordinates, in range, and a valid radius.
 *
 * @param value - Coordinates (`null` when empty) and radius.
 * @returns The pickup point, or `null` when it cannot be sent.
 */
export function toPickup(value: {
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly radius: number;
}): Pickup | null {
  const { latitude, longitude, radius } = value;
  if (latitude === null || longitude === null || !isValidRadius(radius)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude, radius };
}

/** Largest radius the widget accepts, in meters. */
export const MAX_RADIUS = 50_000;

/**
 * Whether a radius can be sent: a whole number of meters, from 1 to {@link MAX_RADIUS}.
 *
 * @param radius - The radius.
 * @returns `true` when valid.
 */
export const isValidRadius = (radius: number): boolean =>
  Number.isInteger(radius) && radius >= 1 && radius <= MAX_RADIUS;
