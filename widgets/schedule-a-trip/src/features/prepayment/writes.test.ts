import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostError } from '../../test/fake-bo';
import { BOOKING_ID, moneySetup, NOW } from '../../test/prepayment-fixtures';
import { RATE_LIMIT_WAIT_MS, refuse, withEvents, writeOver } from './writes';

let setup: Awaited<ReturnType<typeof moneySetup>>;
afterEach(() => setup?.disconnect());

const note = (text: string) => () => ({ mode: 'update' as const, patch: { internalNotes: text } });

describe('writeOver', () => {
  it('writes over the version read', async () => {
    setup = await moneySetup();
    await setup.seed({ internalNotes: 'a' });

    const written = await writeOver(setup.deps, BOOKING_ID, note('b'));

    expect(written.ok && written.value.value.internalNotes).toBe('b');
    expect(setup.bo.storage.api.update.mock.calls[0]?.[3]).toEqual({ ifVersion: 1 });
  });

  it('reads again and builds again after a conflict', async () => {
    setup = await moneySetup();
    await setup.seed({ internalNotes: 'a' });
    setup.bo.storage.api.update.mockRejectedValueOnce(hostError('version-conflict', 409));
    const build = vi.fn(note('b'));

    const written = await writeOver(setup.deps, BOOKING_ID, build);

    expect(written.ok).toBe(true);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('gives up after 3 conflicts', async () => {
    setup = await moneySetup();
    await setup.seed({});
    setup.bo.storage.api.update.mockRejectedValue(hostError('version-conflict', 409));
    expect(await writeOver(setup.deps, BOOKING_ID, note('b'))).toEqual({ ok: false, error: { kind: 'conflict' } });
    expect(setup.bo.storage.api.update).toHaveBeenCalledTimes(3);
  });

  it('waits once after rate-limited, never in a loop', async () => {
    setup = await moneySetup();
    await setup.seed({});
    const sleep = vi.fn(async () => undefined);
    setup.bo.storage.api.update.mockRejectedValue(hostError('rate-limited', 429));

    const written = await writeOver({ ...setup.deps, sleep }, BOOKING_ID, note('b'));

    expect(written).toEqual({ ok: false, error: { kind: 'rate-limited' } });
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(RATE_LIMIT_WAIT_MS);
    expect(setup.bo.storage.api.update).toHaveBeenCalledTimes(2);
  });

  it('succeeds after one wait', async () => {
    setup = await moneySetup();
    await setup.seed({});
    setup.bo.storage.api.update.mockRejectedValueOnce(hostError('rate-limited', 429));
    expect((await writeOver(setup.deps, BOOKING_ID, note('b'))).ok).toBe(true);
  });

  it('never recreates a missing document', async () => {
    setup = await moneySetup();
    expect(await writeOver(setup.deps, BOOKING_ID, note('b'))).toEqual({ ok: false, error: { kind: 'not-found' } });
    expect(setup.bo.storage.api.set).not.toHaveBeenCalled();
  });

  it('gives the refusal of the builder without writing', async () => {
    setup = await moneySetup();
    await setup.seed({});
    expect(await writeOver(setup.deps, BOOKING_ID, () => refuse('changed'))).toEqual({ ok: false, error: { kind: 'refused', reason: 'changed' } });
    expect(setup.bo.storage.api.update).not.toHaveBeenCalled();
  });

  it('gives a read failure', async () => {
    setup = await moneySetup();
    setup.bo.storage.api.get.mockRejectedValueOnce(hostError('quota-exceeded', 507));
    expect(await writeOver(setup.deps, BOOKING_ID, note('b'))).toEqual({ ok: false, error: { kind: 'quota-exceeded' } });
  });

  it('starts and removes the expiry for the end and the reopening of a cycle', async () => {
    setup = await moneySetup();
    await setup.seed({ refundedAt: NOW.toISOString(), toRegularize: { missingAmount: 1, at: NOW.toISOString() }, regularizationPending: true });
    await writeOver(setup.deps, BOOKING_ID, () => ({ mode: 'end', patch: { regularizedAt: NOW.toISOString(), regularizedBy: 'u', regularizationPending: false } }));
    expect(setup.stored()?.expiresAt).toBeTruthy();
    await writeOver(setup.deps, BOOKING_ID, () => ({ mode: 'reopen', patch: { regularizedAt: null, regularizedBy: null, regularizationPending: true } }));
    expect(setup.stored()?.expiresAt).toBeUndefined();
  });
});

describe('withEvents', () => {
  const ev = (type: string) => ({ at: NOW.toISOString(), by: null, type });

  it('appends in order, without changing the journal given', () => {
    const events = [ev('a')];
    expect(withEvents(events, [ev('b'), ev('c')]).map((event) => event.type)).toEqual(['a', 'b', 'c']);
    expect(events).toHaveLength(1);
  });

  it('starts a journal and keeps the 50 newest', () => {
    expect(withEvents(undefined, [])).toEqual([]);
    const many = Array.from({ length: 50 }, (_, index) => ev(String(index)));
    const kept = withEvents(many, [ev('new')]);
    expect(kept).toHaveLength(50);
    expect(kept.at(-1)?.type).toBe('new');
    expect(kept[0]?.type).toBe('1');
  });
});
