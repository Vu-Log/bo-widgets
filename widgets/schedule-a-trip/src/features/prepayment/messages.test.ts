import { describe, expect, it } from 'vitest';
import { BoError } from '@vulog/bo-widget-sdk';
import { actionErrorText, moneyBlocker, storageErrorText } from './messages';

describe('actionErrorText', () => {
  it('names the action on a 403', () => {
    expect(actionErrorText('refund', { kind: 'not-allowed', status: 403 })).toEqual({ key: 'prepayment.notAllowed.refund' });
    expect(actionErrorText('charge', { kind: 'not-allowed', status: 403 })).toEqual({ key: 'prepayment.notAllowed.charge' });
  });

  it('gives the common message otherwise', () => {
    expect(actionErrorText('retry', { kind: 'http', status: 500 })).toEqual({ key: 'api.error.http', params: { status: 500 } });
  });
});

describe('storageErrorText', () => {
  it('maps each failure', () => {
    expect(storageErrorText({ kind: 'conflict' }).key).toBe('prepayment.storage.changed');
    expect(storageErrorText({ kind: 'refused', reason: 'changed' }).key).toBe('prepayment.storage.changed');
    expect(storageErrorText({ kind: 'not-found' }).key).toBe('prepayment.storage.gone');
    expect(storageErrorText({ kind: 'rate-limited' }).key).toBe('prepayment.storage.rateLimited');
    expect(storageErrorText({ kind: 'forbidden' }).key).toBe('prepayment.notAllowed.storage');
    expect(storageErrorText({ kind: 'unknown-outcome', error: new BoError('TIMEOUT', 'timeout') }).key).toBe('prepayment.storage.unknownOutcome');
    expect(storageErrorText({ kind: 'already-in-progress', startedAt: '', startedBy: null }).key).toBe('prepayment.charge.alreadyInProgress');
    expect(storageErrorText({ kind: 'already-charged', invoiceId: 'i' }).key).toBe('prepayment.charge.alreadyCharged');
    expect(storageErrorText({ kind: 'too-recent' }).key).toBe('prepayment.verify.tooRecent');
    expect(storageErrorText({ kind: 'no-claim' }).key).toBe('prepayment.verify.noClaim');
    expect(storageErrorText({ kind: 'too-large' }).key).toBe('prepayment.storage.failed');
    expect(storageErrorText({ kind: 'invalid-input', reason: 'too-long' }).key).toBe('prepayment.storage.tooLong');
    expect(storageErrorText({ kind: 'other-claim' }).key).toBe('prepayment.verify.otherClaim');
    expect(storageErrorText({ kind: 'charge-accepted' }).key).toBe('prepayment.verify.accepted');
  });
});

describe('moneyBlocker', () => {
  it('blocks while loading, when unreadable, invalid, or without an operator', () => {
    expect(moneyBlocker(undefined, 'u')).toEqual({ key: 'common.loading' });
    expect(moneyBlocker(null, 'u')).toEqual({ key: 'settings.unavailable' });
    expect(
      moneyBlocker(
        { ok: false, issues: [{ key: 'ratio', message: 'x', problem: 'invalid' }, { key: 'ratio', message: 'y', problem: 'invalid' }, { key: 'dayRate', message: 'z', problem: 'missing' }] },
        'u',
      ),
    ).toEqual({ key: 'prepayment.blocked.settings', params: { keys: 'ratio, dayRate' } });
    expect(moneyBlocker({ ok: true, settings: {} as never }, null)).toEqual({ key: 'prepayment.blocked.noUser' });
  });

  it('lets the actions run with valid settings and an operator', () => {
    expect(moneyBlocker({ ok: true, settings: {} as never }, 'u')).toBeNull();
  });
});
