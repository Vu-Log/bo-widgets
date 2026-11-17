/** What {@link bookableProfiles} and {@link bookableServices} read of a registration overview. */
export interface OverviewInput {
  readonly profiles: readonly {
    readonly profileId: string;
    readonly type: string;
    readonly status: string;
    readonly approvedServiceIds: readonly string[];
  }[];
  readonly services: readonly {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly fleetId: string;
    readonly cityId: string;
  }[];
}

const CLOSED_PROFILE_STATUSES = new Set(['INACTIVE', 'ARCHIVED']);
const BOOKABLE_PROFILE_TYPES = new Set(['Single', 'Business']);

/**
 * The profiles a booking can be made with: personal (`Single`) or business ones, neither inactive
 * nor archived, as in the back office.
 *
 * @param overview - The registration overview of the customer.
 * @returns The profiles, in the order of the overview.
 */
export const bookableProfiles = (overview: OverviewInput): OverviewInput['profiles'] =>
  overview.profiles.filter(
    (profile) => BOOKABLE_PROFILE_TYPES.has(profile.type) && !CLOSED_PROFILE_STATUSES.has(profile.status),
  );

/**
 * The services a booking can use with a profile: approved for it, free floating, of the fleet.
 *
 * @param overview - The registration overview of the customer.
 * @param profileId - The profile chosen.
 * @param fleetId - The fleet (compared without case, as in the back office).
 * @returns The services, in the order of the catalogue.
 */
export function bookableServices(
  overview: OverviewInput,
  profileId: string,
  fleetId: string,
): OverviewInput['services'] {
  const approved = new Set(
    overview.profiles.find((profile) => profile.profileId === profileId)?.approvedServiceIds ?? [],
  );
  return overview.services.filter(
    (service) =>
      approved.has(service.id) &&
      service.type === 'FREE_FLOATING' &&
      service.fleetId.toLowerCase() === fleetId.toLowerCase(),
  );
}
