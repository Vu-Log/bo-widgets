import { describe, expect, it } from 'vitest';
import {
  datesProblems,
  defaultReturn,
  defaultStart,
  fromZonedInput,
  isValidRadius,
  MAX_RADIUS,
  toZonedInput,
} from './booking-dates';

describe('defaultStart and defaultReturn', () => {
  it('starts at the next quarter of an hour and lasts 2 hours', () => {
    expect(defaultStart(new Date('2026-03-10T08:07:30Z')).toISOString()).toBe('2026-03-10T08:15:00.000Z');
    expect(defaultStart(new Date('2026-03-10T08:15:00Z')).toISOString()).toBe('2026-03-10T08:30:00.000Z');
    expect(defaultReturn(new Date('2026-03-10T08:15:00Z')).toISOString()).toBe('2026-03-10T10:15:00.000Z');
  });
});

describe('toZonedInput and fromZonedInput', () => {
  it('write and read a date in the zone of the fleet', () => {
    const date = new Date('2026-03-10T08:00:00Z');
    expect(toZonedInput(date, 'Asia/Tokyo')).toBe('2026-03-10T17:00');
    expect(fromZonedInput('2026-03-10T17:00', 'Asia/Tokyo')?.toISOString()).toBe(date.toISOString());
  });

  it('use the zone of the browser without one', () => {
    const date = new Date('2026-03-10T08:00:00Z');
    expect(fromZonedInput(toZonedInput(date, null), null)?.toISOString()).toBe(date.toISOString());
  });

  it('read an empty or broken value as none', () => {
    expect(fromZonedInput('', 'UTC')).toBeNull();
    expect(fromZonedInput('2026-03-10', 'UTC')).toBeNull();
    expect(fromZonedInput('2026-13-45T99:99', 'UTC')).toBeNull();
  });
});

describe('datesProblems', () => {
  const now = new Date('2026-03-10T08:00:00Z');
  const at = (iso: string) => new Date(iso);

  it('accepts a future start, with or without a later return', () => {
    expect(datesProblems({ start: at('2026-03-10T09:00:00Z'), plannedReturn: null, now })).toEqual([]);
    expect(datesProblems({ start: at('2026-03-10T09:00:00Z'), plannedReturn: at('2026-03-10T10:00:00Z'), now })).toEqual([]);
  });

  it('refuses a missing or past start and a return not after it', () => {
    expect(datesProblems({ start: null, plannedReturn: null, now })).toEqual(['start-missing']);
    expect(datesProblems({ start: now, plannedReturn: now, now })).toEqual(['start-past', 'return-before-start']);
  });
});

describe('isValidRadius', () => {
  it('takes whole meters from 1 to the maximum', () => {
    expect(isValidRadius(1)).toBe(true);
    expect(isValidRadius(MAX_RADIUS)).toBe(true);
    expect(isValidRadius(0)).toBe(false);
    expect(isValidRadius(10.5)).toBe(false);
    expect(isValidRadius(MAX_RADIUS + 1)).toBe(false);
    expect(isValidRadius(Number.NaN)).toBe(false);
  });
});
