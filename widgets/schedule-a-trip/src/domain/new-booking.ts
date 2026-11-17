import type { NewBookingRequest } from '../api/schedule-a-trip';
import { datesProblems, toPickup, type DatesProblem } from './booking-dates';

/** Largest notes of a booking, as the back office takes them. */
export const MAX_NOTES_LENGTH = 1024;

/** A booking being created, as the wizard holds it. */
export interface NewBookingDraft {
  readonly userId: string | null;
  readonly profileId: string | null;
  readonly service: { readonly id: string; readonly cityId: string } | null;
  readonly start: Date | null;
  readonly plannedReturn: Date | null;
  readonly modelId: number | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly radius: number;
  readonly notes: string;
}

/** Why a draft cannot be sent. */
export type NewBookingProblem =
  | 'customer-missing'
  | 'service-missing'
  | DatesProblem
  | 'pickup-invalid'
  | 'notes-too-long';

/** A booking ready to be created: every rule checked (the body of the creation request). */
export type ValidNewBooking = NewBookingRequest;

/**
 * Checks a booking being created and builds the request: a customer and a profile, a service, a
 * future start before the planned return, a pickup point in range with a valid radius, and notes of
 * at most {@link MAX_NOTES_LENGTH} characters.
 *
 * @param draft - What the wizard holds.
 * @param now - The current time.
 * @returns The booking to create, or every problem found.
 */
export function buildNewBooking(
  draft: NewBookingDraft,
  now: Date,
): { readonly ok: true; readonly value: ValidNewBooking } | { readonly ok: false; readonly problems: readonly NewBookingProblem[] } {
  const problems: NewBookingProblem[] = [];
  if (draft.userId === null || draft.profileId === null) problems.push('customer-missing');
  if (draft.service === null) problems.push('service-missing');
  problems.push(...datesProblems({ start: draft.start, plannedReturn: draft.plannedReturn, now }));
  const pickup = toPickup(draft);
  if (pickup === null) problems.push('pickup-invalid');
  if (draft.notes.length > MAX_NOTES_LENGTH) problems.push('notes-too-long');
  if (problems.length > 0 || !draft.userId || !draft.profileId || !draft.service || !draft.start || !pickup) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    value: {
      userId: draft.userId,
      profileId: draft.profileId,
      serviceId: draft.service.id,
      cityId: draft.service.cityId,
      start: draft.start,
      plannedReturn: draft.plannedReturn,
      modelId: draft.modelId,
      ...pickup,
      notes: draft.notes,
    },
  };
}
