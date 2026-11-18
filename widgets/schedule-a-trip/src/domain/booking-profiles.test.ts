import { describe, expect, it } from 'vitest';
import { bookableProfiles, bookableServices } from './booking-profiles';

const overview = {
  profiles: [
    { profileId: 'p-1', type: 'Single', status: 'APPROVED', approvedServiceIds: ['s-1', 's-2', 's-3'] },
    { profileId: 'p-2', type: 'Business', status: 'SUSPENDED', approvedServiceIds: [] },
    { profileId: 'p-3', type: 'Single', status: 'ARCHIVED', approvedServiceIds: [] },
    { profileId: 'p-4', type: 'Family', status: 'APPROVED', approvedServiceIds: [] },
    { profileId: 'p-5', type: 'Business', status: 'INACTIVE', approvedServiceIds: [] },
  ],
  services: [
    { id: 's-1', name: 'Cars', type: 'FREE_FLOATING', fleetId: 'fleet-1', cityId: 'c' },
    { id: 's-2', name: 'Stations', type: 'BOOKING', fleetId: 'FLEET-1', cityId: 'c' },
    { id: 's-3', name: 'Other fleet', type: 'FREE_FLOATING', fleetId: 'FLEET-2', cityId: 'c' },
    { id: 's-4', name: 'Not approved', type: 'FREE_FLOATING', fleetId: 'FLEET-1', cityId: 'c' },
  ],
};

describe('bookableProfiles', () => {
  it('keeps the personal and business profiles that are not closed', () => {
    expect(bookableProfiles(overview).map((profile) => profile.profileId)).toEqual(['p-1', 'p-2']);
  });

  it('gives none without profile', () => {
    expect(bookableProfiles({ profiles: [], services: [] })).toEqual([]);
  });
});

describe('bookableServices', () => {
  it('keeps the approved free floating services of the fleet', () => {
    expect(bookableServices(overview, 'p-1', 'FLEET-1').map((service) => service.id)).toEqual(['s-1']);
  });

  it('gives none for a profile without approval or unknown', () => {
    expect(bookableServices(overview, 'p-2', 'FLEET-1')).toEqual([]);
    expect(bookableServices(overview, 'p-9', 'FLEET-1')).toEqual([]);
  });
});
