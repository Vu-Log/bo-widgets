import { afterEach, describe, expect, it } from 'vitest';
import { hostError } from '../../test/fake-bo';
import { BOOKING_ID, moneySetup } from '../../test/prepayment-fixtures';
import { MAX_NOTE_LENGTH } from '../../storage/booking-state';
import { saveInternalNotes } from './notes';

let setup: Awaited<ReturnType<typeof moneySetup>>;
afterEach(() => setup?.disconnect());

describe('saveInternalNotes', () => {
  it('creates the document, with allocationProcessed false, when the widget never wrote', async () => {
    setup = await moneySetup();

    const written = await saveInternalNotes(setup.deps, BOOKING_ID, 'Call before', false);

    expect(written.ok).toBe(true);
    expect(setup.stored()?.value).toMatchObject({ fleetId: 'FLEET-1', allocationProcessed: false, internalNotes: 'Call before' });
    expect(setup.stored()?.expiresAt).toBeUndefined();
  });

  it('updates an existing document, keeping its other fields', async () => {
    setup = await moneySetup();
    await setup.seed({ invoiceId: 'i-1', chargeStartedAt: '2026-03-01T00:00:00.000Z' });

    await saveInternalNotes(setup.deps, BOOKING_ID, 'New', true);

    expect(setup.stored()?.value).toMatchObject({ invoiceId: 'i-1', internalNotes: 'New' });
    expect((setup.stored()?.value.events as { type: string }[]).at(-1)?.type).toBe('internal-notes-saved');
  });

  it('writes over a document created meanwhile', async () => {
    setup = await moneySetup();
    await setup.seed({ chargeStartedAt: '2026-03-01T00:00:00.000Z' });
    const written = await saveInternalNotes(setup.deps, BOOKING_ID, 'x', false);
    expect(written.ok && written.value.value).toMatchObject({ internalNotes: 'x', chargeStartedAt: '2026-03-01T00:00:00.000Z' });
  });

  it('never recreates a document that disappeared', async () => {
    setup = await moneySetup();
    expect(await saveInternalNotes(setup.deps, BOOKING_ID, 'x', true)).toEqual({ ok: false, error: { kind: 'not-found' } });
    expect(setup.stored()).toBeUndefined();
  });

  it('refuses more than 500 characters', async () => {
    setup = await moneySetup();
    expect(await saveInternalNotes(setup.deps, BOOKING_ID, 'x'.repeat(MAX_NOTE_LENGTH + 1), false)).toEqual({ ok: false, error: { kind: 'refused', reason: 'too-long' } });
  });

  it('gives a storage failure of the creation', async () => {
    setup = await moneySetup();
    setup.bo.storage.api.set.mockRejectedValueOnce(hostError('quota-exceeded', 507));
    expect(await saveInternalNotes(setup.deps, BOOKING_ID, 'x', false)).toEqual({ ok: false, error: { kind: 'quota-exceeded' } });
  });
});
