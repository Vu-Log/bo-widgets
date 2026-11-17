import { describe, expect, it } from 'vitest';
import { refundPolicy } from './refund-policy';

const settings = { refundFullHours: 24, creditsRevokeHours: 1 };
const start = new Date('2026-03-10T10:00:00.000Z');
const before = (minutes: number) => new Date(start.getTime() - minutes * 60_000);

describe('refundPolicy', () => {
  it('refunds in full when cancelled well before the start', () => {
    expect(refundPolicy(before(3 * 24 * 60), start, settings)).toEqual({
      kind: 'full-refund',
      hoursBeforeStart: 72,
    });
  });

  it('refunds in full when cancelled exactly refundFullHours before', () => {
    expect(refundPolicy(before(24 * 60), start, settings).kind).toBe('full-refund');
  });

  it('charges the fees just under refundFullHours', () => {
    expect(refundPolicy(before(24 * 60 - 1), start, settings).kind).toBe('refund-with-fee');
  });

  it('charges the fees when cancelled exactly creditsRevokeHours before', () => {
    expect(refundPolicy(before(60), start, settings).kind).toBe('refund-with-fee');
  });

  it('charges the fees and revokes the credits just under creditsRevokeHours', () => {
    expect(refundPolicy(before(59), start, settings)).toEqual({
      kind: 'refund-with-fee-and-credits-revocation',
      hoursBeforeStart: 59 / 60,
    });
  });

  it('revokes the credits when cancelled after the start', () => {
    expect(refundPolicy(before(-30), start, settings)).toEqual({
      kind: 'refund-with-fee-and-credits-revocation',
      hoursBeforeStart: -0.5,
    });
  });

  it('follows the configured thresholds', () => {
    const custom = { refundFullHours: 48, creditsRevokeHours: 2 };
    expect(refundPolicy(before(30 * 60), start, custom).kind).toBe('refund-with-fee');
    expect(refundPolicy(before(90), start, custom).kind).toBe(
      'refund-with-fee-and-credits-revocation',
    );
  });

  it('never changes the dates it reads', () => {
    const cancelledAt = before(90);
    refundPolicy(cancelledAt, start, settings);
    expect(cancelledAt.toISOString()).toBe('2026-03-10T08:30:00.000Z');
    expect(start.toISOString()).toBe('2026-03-10T10:00:00.000Z');
  });

  it('throws on an invalid date', () => {
    expect(() => refundPolicy(new Date('nope'), start, settings)).toThrow(RangeError);
    expect(() => refundPolicy(start, new Date('nope'), settings)).toThrow(RangeError);
  });
});
