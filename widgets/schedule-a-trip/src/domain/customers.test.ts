import { describe, expect, it } from 'vitest';
import { customerName, initialsOf, isBusinessBooking } from './customers';

const customer = {
  firstName: 'Jane',
  lastName: 'Doe',
  userName: 'jane.doe',
  profiles: [
    { id: 'profile-1', type: 'Single' },
    { id: 'profile-2', type: 'Business' },
    { id: null, type: 'Business' },
  ],
};

describe('customerName', () => {
  it('joins the first and last names', () => {
    expect(customerName(customer)).toBe('Jane Doe');
  });

  it('falls back to the user name, then to null', () => {
    expect(customerName({ ...customer, firstName: ' ', lastName: null })).toBe('jane.doe');
    expect(customerName({ ...customer, firstName: null, lastName: null, userName: null })).toBeNull();
  });
});

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('jane van doe')).toBe('JV');
    expect(initialsOf('Élodie')).toBe('É');
    expect(initialsOf('  ')).toBe('');
  });
});

describe('isBusinessBooking', () => {
  it('reads the type of the profile of the booking', () => {
    expect(isBusinessBooking(customer, 'profile-2')).toBe(true);
    expect(isBusinessBooking(customer, 'profile-1')).toBe(false);
  });

  it('is null for a profile the customer does not have, or no profile', () => {
    expect(isBusinessBooking(customer, 'profile-9')).toBeNull();
    expect(isBusinessBooking(customer, null)).toBeNull();
  });
});
