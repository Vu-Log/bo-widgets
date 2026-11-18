/** What the helpers of this module read of a customer (`Customer` of `api/users`). */
export interface NamedCustomer {
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly userName: string | null;
  readonly profiles: readonly { readonly id: string | null; readonly type: string | null }[];
}

/**
 * The name to show for a customer: first and last names, else the user name.
 *
 * @param customer - The customer.
 * @returns The name, `null` when the customer has none.
 */
export function customerName(customer: NamedCustomer): string | null {
  const full = [customer.firstName, customer.lastName]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
  return full || customer.userName?.trim() || null;
}

/**
 * The initials of a name, for an avatar: the first letter of its first two words.
 *
 * @param name - A name.
 * @returns One or two capital letters, `''` for a blank name.
 */
export const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => [...word][0] ?? '')
    .join('')
    .toUpperCase();

/**
 * Whether a booking is made with a business profile of its customer.
 *
 * @param customer - The customer of the booking.
 * @param profileId - `profileId` of the booking.
 * @returns `true` for a `Business` profile, `false` for another type, `null` when the profile is
 *   not among those of the customer.
 */
export function isBusinessBooking(customer: NamedCustomer, profileId: string | null): boolean | null {
  const profile = customer.profiles.find((candidate) => candidate.id !== null && candidate.id === profileId);
  if (!profile) return null;
  return profile.type === 'Business';
}
