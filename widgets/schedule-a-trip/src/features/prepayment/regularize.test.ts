import { afterEach, describe, expect, it } from 'vitest';
import { BOOKING_ID, moneySetup, NOW } from '../../test/prepayment-fixtures';
import { MAX_NOTE_LENGTH } from '../../storage/booking-state';
import { markRegularized, undoRegularization } from './regularize';

let setup: Awaited<ReturnType<typeof moneySetup>>;
afterEach(() => setup?.disconnect());

const pending = {
  refundedAt: NOW.toISOString(),
  toRegularize: { missingAmount: 10, at: NOW.toISOString() },
  regularizationPending: true,
};

describe('markRegularized', () => {
  it('records who, when and the note, keeps the amount, and starts the expiry', async () => {
    setup = await moneySetup();
    await setup.seed(pending);

    const written = await markRegularized(setup.deps, BOOKING_ID, '  Credit note issued ');

    expect(written.ok && written.value.value).toMatchObject({
      regularizedAt: NOW.toISOString(),
      regularizedBy: 'operator-1',
      regularizationNote: 'Credit note issued',
      regularizationPending: false,
      toRegularize: { missingAmount: 10 },
    });
    expect(setup.stored()?.expiresAt).toBeTruthy();
    expect((setup.stored()?.value.events as { type: string }[]).at(-1)?.type).toBe('regularized');
  });

  it('writes a null note when none is given', async () => {
    setup = await moneySetup();
    await setup.seed(pending);
    const written = await markRegularized(setup.deps, BOOKING_ID, '   ');
    expect(written.ok && written.value.value.regularizationNote).toBeNull();
  });

  it('refuses when nothing is pending, or a note too long', async () => {
    setup = await moneySetup();
    await setup.seed({});
    expect(await markRegularized(setup.deps, BOOKING_ID, '')).toEqual({ ok: false, error: { kind: 'refused', reason: 'not-pending' } });
    expect(await markRegularized(setup.deps, BOOKING_ID, 'x'.repeat(MAX_NOTE_LENGTH + 1))).toEqual({ ok: false, error: { kind: 'refused', reason: 'note-too-long' } });
  });

  it('says not-found when the document is gone', async () => {
    setup = await moneySetup();
    expect(await markRegularized(setup.deps, BOOKING_ID, '')).toEqual({ ok: false, error: { kind: 'not-found' } });
  });
});

describe('undoRegularization', () => {
  it('puts the regularization back to do and removes the expiry', async () => {
    setup = await moneySetup();
    await setup.seed(pending);
    await markRegularized(setup.deps, BOOKING_ID, 'note');

    const written = await undoRegularization(setup.deps, BOOKING_ID);

    expect(written.ok && written.value.value).toMatchObject({
      regularizedAt: null,
      regularizedBy: null,
      regularizationNote: null,
      regularizationPending: true,
      toRegularize: { missingAmount: 10 },
    });
    expect(setup.stored()?.expiresAt).toBeUndefined();
  });

  it('refuses when not regularized', async () => {
    setup = await moneySetup();
    await setup.seed(pending);
    expect(await undoRegularization(setup.deps, BOOKING_ID)).toEqual({ ok: false, error: { kind: 'refused', reason: 'not-regularized' } });
  });
});
