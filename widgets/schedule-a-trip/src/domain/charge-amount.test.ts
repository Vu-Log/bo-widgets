import { describe, expect, it } from 'vitest';
import { amountWarnings, computeChargeAmount, estimateDuration, round2 } from './charge-amount';

const settings = { dayRate: 100, ratio: 1, minimumAmount: 10 };
const start = new Date('2026-03-10T10:00:00.000Z');
const hoursLater = (hours: number, minutes = 0) =>
  new Date(start.getTime() + hours * 3_600_000 + minutes * 60_000);

describe('round2', () => {
  it('rounds to 2 decimals, half away from zero', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(20.8333)).toBe(20.83);
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(0)).toBe(0);
  });
});

describe('computeChargeAmount', () => {
  it('charges the whole hours at the hourly rate of the day rate and ratio', () => {
    // 5 h × 60 × 100 / 1440 = 20.8333…
    expect(computeChargeAmount(start, hoursLater(5), settings)).toBe(20.83);
  });

  it('counts whole hours only', () => {
    expect(computeChargeAmount(start, hoursLater(26, 59), settings)).toBe(108.33);
  });

  it('applies the ratio', () => {
    expect(computeChargeAmount(start, hoursLater(5), { ...settings, ratio: 1.5 })).toBe(31.25);
  });

  it('never goes below the minimum amount', () => {
    expect(computeChargeAmount(start, hoursLater(2), settings)).toBe(10);
  });

  it('gives exactly the minimum amount when the formula reaches it', () => {
    // 3 h × 60 × 80 / 1440 = 10
    expect(computeChargeAmount(start, hoursLater(3), { ...settings, dayRate: 80 })).toBe(10);
  });

  it('rounds a half cent up', () => {
    // 1 h × 60 × 0.12 / 1440 = 0.005
    expect(
      computeChargeAmount(start, hoursLater(1), { dayRate: 0.12, ratio: 1, minimumAmount: 0.001 }),
    ).toBe(0.01);
  });

  it('gives the minimum amount when the end is at or before the start', () => {
    expect(computeChargeAmount(start, start, settings)).toBe(10);
    expect(computeChargeAmount(start, hoursLater(-5), settings)).toBe(10);
  });

  it('gives null without an end date', () => {
    expect(computeChargeAmount(start, null, settings)).toBeNull();
  });

  it('throws on an invalid date', () => {
    expect(() => computeChargeAmount(new Date('nope'), hoursLater(1), settings)).toThrow(
      RangeError,
    );
    expect(() => computeChargeAmount(start, new Date('nope'), settings)).toThrow(RangeError);
    expect(() => computeChargeAmount(new Date('nope'), null, settings)).toThrow(RangeError);
  });

  it('does not change the dates', () => {
    const end = hoursLater(5);
    computeChargeAmount(start, end, settings);
    expect(start.toISOString()).toBe('2026-03-10T10:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-10T15:00:00.000Z');
  });
});

describe('estimateDuration', () => {
  it('gives the whole hours an amount pays for, in days and hours', () => {
    // hourly rate 100 / 24 = 4.1666…: 125 pays 30 h
    expect(estimateDuration(125, settings)).toEqual({ days: 1, hours: 6, totalHours: 30 });
  });

  it('applies the ratio to the hourly rate', () => {
    expect(estimateDuration(125, { ...settings, ratio: 2 })).toEqual({
      days: 0,
      hours: 15,
      totalHours: 15,
    });
  });

  it('absorbs the binary error of the division', () => {
    // hourly rate 2.4 / 24 = 0.1, and 0.3 / 0.1 is 2.9999999999999996 in binary
    expect(estimateDuration(0.3, { ...settings, dayRate: 2.4 })?.totalHours).toBe(3);
  });

  it('floors: a computed amount rounded down pays one hour less', () => {
    // 5 h compute 20.83, which pays 4.9992 h
    expect(estimateDuration(20.83, settings)?.totalHours).toBe(4);
  });

  it('gives null for an amount that is not a positive number', () => {
    expect(estimateDuration(0, settings)).toBeNull();
    expect(estimateDuration(-5, settings)).toBeNull();
    expect(estimateDuration(Number.NaN, settings)).toBeNull();
    expect(estimateDuration(Number.POSITIVE_INFINITY, settings)).toBeNull();
  });
});

describe('amountWarnings', () => {
  it('accepts the computed amount without a warning', () => {
    expect(amountWarnings(20.83, 20.83, settings)).toEqual({ valid: true, warnings: [] });
  });

  it('warns about an amount above the computed one', () => {
    expect(amountWarnings(25, 20.83, settings)).toEqual({
      valid: true,
      warnings: ['above-computed'],
    });
  });

  it('does not warn about an amount below the computed one but not below the minimum', () => {
    expect(amountWarnings(15, 20.83, settings)).toEqual({ valid: true, warnings: [] });
    expect(amountWarnings(10, 20.83, settings)).toEqual({ valid: true, warnings: [] });
  });

  it('warns about an amount below the minimum', () => {
    expect(amountWarnings(5, 20.83, settings)).toEqual({
      valid: true,
      warnings: ['below-minimum'],
    });
  });

  it('gives both warnings when they both apply', () => {
    expect(amountWarnings(8, 6, settings)).toEqual({
      valid: true,
      warnings: ['above-computed', 'below-minimum'],
    });
  });

  it('only checks the minimum without a computed amount', () => {
    expect(amountWarnings(500, null, settings)).toEqual({ valid: true, warnings: [] });
    expect(amountWarnings(5, null, settings)).toEqual({ valid: true, warnings: ['below-minimum'] });
  });

  it('refuses 0, a negative amount and what is not a number', () => {
    expect(amountWarnings(0, 20, settings)).toEqual({ valid: false });
    expect(amountWarnings(-1, 20, settings)).toEqual({ valid: false });
    expect(amountWarnings(Number.NaN, 20, settings)).toEqual({ valid: false });
    expect(amountWarnings(Number.POSITIVE_INFINITY, 20, settings)).toEqual({ valid: false });
  });
});
