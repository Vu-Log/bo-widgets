import { describe, expect, it } from 'vitest';
import { isHeldFor, preallocationReason } from './preallocation';

describe('preallocationReason and isHeldFor', () => {
  it('names the booking in the reason, and recognizes it', () => {
    const reason = preallocationReason('booking-1');
    expect(reason).toBe('Schedule a trip booking-1');
    expect(isHeldFor(reason, 'booking-1')).toBe(true);
  });

  it('does not take a vehicle out of service for something else', () => {
    expect(isHeldFor('Repair', 'booking-1')).toBe(false);
    expect(isHeldFor(preallocationReason('booking-10'), 'booking-1')).toBe(false);
    expect(isHeldFor('Repair after booking-1', 'booking-1')).toBe(false);
    expect(isHeldFor(preallocationReason('booking-2'), 'booking-1')).toBe(false);
    expect(isHeldFor(null, 'booking-1')).toBe(false);
  });
});
