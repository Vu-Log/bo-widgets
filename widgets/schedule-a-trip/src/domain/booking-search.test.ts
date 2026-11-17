import { describe, expect, it } from 'vitest';
import { foldText, matchesSearch } from './booking-search';

const booking = {
  bookingId: 'b0a1-77',
  customerTexts: ['Jane', 'Doé', 'jane.doe'],
  plate: 'AB-123-CD',
};

describe('foldText', () => {
  it('drops the case, the accents and the separators', () => {
    expect(foldText(' Élodie  AB-123.cd_x ')).toBe('elodieab123cdx');
  });
});

describe('matchesSearch', () => {
  it('matches everything with a blank query', () => {
    expect(matchesSearch('   ', booking)).toBe(true);
  });

  it('finds the booking id, the plate and the names', () => {
    expect(matchesSearch('b0a1', booking)).toBe(true);
    expect(matchesSearch('ab123', booking)).toBe(true);
    expect(matchesSearch('jane doe', booking)).toBe(true);
  });

  it('needs every word', () => {
    expect(matchesSearch('jane smith', booking)).toBe(false);
  });

  it('ignores what is not loaded', () => {
    expect(matchesSearch('jane', { bookingId: 'x', customerTexts: [null], plate: null })).toBe(false);
  });
});
