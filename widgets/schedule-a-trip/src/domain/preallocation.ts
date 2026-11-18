import { isBusinessBooking, type NamedCustomer } from './customers';

/**
 * The reason a pre-allocated vehicle is out of service with: it names the booking, so that the
 * widget (and an operator in the back office) know why and for which booking.
 *
 * @param bookingId - The booking.
 * @returns The sub-status.
 */
export const preallocationReason = (bookingId: string): string => `Schedule a trip ${bookingId}`;

/**
 * Whether a vehicle is out of service for a booking: its reason is exactly the one the widget
 * wrote for that booking. A vehicle put out of service for another reason since (or for another
 * booking whose id contains this one) must not be put back in service by the widget.
 *
 * @param outOfServiceReason - The reason of the vehicle, `null` when in service.
 * @param bookingId - The booking.
 * @returns `true` when the vehicle is held for the booking.
 */
export const isHeldFor = (outOfServiceReason: string | null, bookingId: string): boolean =>
  outOfServiceReason === preallocationReason(bookingId);

/** What {@link preallocationPrepayment} reads of the stored state of a booking. */
export interface PreallocationPrepaymentState {
  readonly isB2B?: boolean | null | undefined;
  readonly invoiceId?: string | null | undefined;
  readonly invoiceStatus?: string | null | undefined;
}

/**
 * Whether the prepayment of a booking allows a vehicle to be pre-allocated, as the former tool
 * allowed it: a paid prepayment, or a business booking (never prepaid).
 *
 * - `allowed`: the invoice is `PAID`, or the booking is a business one (`isB2B` stored, or a
 *   `Business` profile of the customer).
 * - `loading`: the stored state, or the customer when it decides, is not loaded yet (fail closed).
 * - `unpaid`: anything else (not charged, payment pending or failed, refunded).
 *
 * The invoice status is the one of the stored state, which the widget refreshes from the live
 * invoice it reads.
 *
 * @param input - The stored state (`undefined` while loading, `null` without one), the customer
 *   (`undefined` while loading) and the profile of the booking.
 * @returns The verdict.
 */
export function preallocationPrepayment(input: {
  readonly state: PreallocationPrepaymentState | null | undefined;
  readonly customer: NamedCustomer | undefined;
  readonly profileId: string | null;
}): 'allowed' | 'loading' | 'unpaid' {
  const { state, customer, profileId } = input;
  if (state === undefined) return 'loading';
  if (state?.isB2B === true) return 'allowed';
  if (state?.invoiceId && state.invoiceStatus === 'PAID') return 'allowed';
  if (customer === undefined) return 'loading';
  return isBusinessBooking(customer, profileId) === true ? 'allowed' : 'unpaid';
}
