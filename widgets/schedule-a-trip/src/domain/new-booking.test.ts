import { describe, expect, it } from 'vitest';
import { buildNewBooking, MAX_NOTES_LENGTH, type NewBookingDraft } from './new-booking';

const now = new Date('2026-03-10T08:00:00Z');
const draft: NewBookingDraft = {
  userId: 'user-1',
  profileId: 'profile-1',
  service: { id: 'service-1', cityId: 'city-1' },
  start: new Date('2026-03-11T08:00:00Z'),
  plannedReturn: null,
  modelId: null,
  latitude: 48.85,
  longitude: 2.35,
  radius: 500,
  notes: '',
};

describe('buildNewBooking', () => {
  it('builds the booking to create', () => {
    expect(buildNewBooking(draft, now)).toEqual({
      ok: true,
      value: {
        userId: 'user-1',
        profileId: 'profile-1',
        serviceId: 'service-1',
        cityId: 'city-1',
        start: draft.start,
        plannedReturn: null,
        modelId: null,
        latitude: 48.85,
        longitude: 2.35,
        radius: 500,
        notes: '',
      },
    });
  });

  it('gives every problem of an incomplete draft', () => {
    expect(
      buildNewBooking(
        { ...draft, profileId: null, service: null, start: now, plannedReturn: now, latitude: 200, notes: 'x'.repeat(MAX_NOTES_LENGTH + 1) },
        now,
      ),
    ).toEqual({
      ok: false,
      problems: ['customer-missing', 'service-missing', 'start-past', 'return-before-start', 'pickup-invalid', 'notes-too-long'],
    });
  });

  it('needs a start', () => {
    expect(buildNewBooking({ ...draft, start: null }, now)).toEqual({ ok: false, problems: ['start-missing'] });
  });
});
