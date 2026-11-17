/**
 * The reason a pre-allocated vehicle is out of service with: it names the booking, so that the
 * widget (and an operator in the back office) know why and for which booking.
 *
 * @param bookingId - The booking.
 * @returns The sub-status.
 */
export const preallocationReason = (bookingId: string): string => `Schedule a trip ${bookingId}`;

/**
 * Whether a vehicle is out of service for a booking: its reason names that booking. A vehicle put
 * out of service for another reason since must not be put back in service by the widget.
 *
 * @param outOfServiceReason - The reason of the vehicle, `null` when in service.
 * @param bookingId - The booking.
 * @returns `true` when the vehicle is held for the booking.
 */
export const isHeldFor = (outOfServiceReason: string | null, bookingId: string): boolean =>
  outOfServiceReason !== null && outOfServiceReason.includes(bookingId);
