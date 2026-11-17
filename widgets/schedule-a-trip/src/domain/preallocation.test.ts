import { describe, expect, it } from 'vitest';
import { isHeldFor, preallocationPrepayment, preallocationReason } from './preallocation';

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

describe('preallocationPrepayment', () => {
  const single = { firstName: 'Jane', lastName: 'Doe', userName: null, profiles: [{ id: 'profile-1', type: 'Single' }] };
  const business = { ...single, profiles: [{ id: 'profile-1', type: 'Business' }] };
  const paid = { invoiceId: 'invoice-1', invoiceStatus: 'PAID' };

  it('allows a paid prepayment, whatever the customer', () => {
    expect(preallocationPrepayment({ state: paid, customer: undefined, profileId: 'profile-1' })).toBe('allowed');
  });

  it('allows a business booking, stored or from the profile of the customer', () => {
    expect(preallocationPrepayment({ state: { isB2B: true }, customer: undefined, profileId: null })).toBe('allowed');
    expect(preallocationPrepayment({ state: null, customer: business, profileId: 'profile-1' })).toBe('allowed');
  });

  it('refuses a prepayment not charged, pending, failed or refunded', () => {
    expect(preallocationPrepayment({ state: null, customer: single, profileId: 'profile-1' })).toBe('unpaid');
    for (const invoiceStatus of ['PENDING', 'REFUSED', 'MOP_MISSING', 'REFUNDED']) {
      expect(preallocationPrepayment({ state: { invoiceId: 'invoice-1', invoiceStatus }, customer: single, profileId: 'profile-1' })).toBe('unpaid');
    }
  });

  it('refuses a status without an invoice, and a profile the customer does not have', () => {
    expect(preallocationPrepayment({ state: { invoiceStatus: 'PAID' }, customer: single, profileId: 'profile-1' })).toBe('unpaid');
    expect(preallocationPrepayment({ state: null, customer: business, profileId: 'profile-9' })).toBe('unpaid');
  });

  it('waits for the stored state, then for the customer when it decides', () => {
    expect(preallocationPrepayment({ state: undefined, customer: business, profileId: 'profile-1' })).toBe('loading');
    expect(preallocationPrepayment({ state: null, customer: undefined, profileId: 'profile-1' })).toBe('loading');
  });
});
