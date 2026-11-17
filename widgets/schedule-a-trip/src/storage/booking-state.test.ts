import { BoError, connect } from '@vulog/bo-widget-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBo, hostError } from '../test/fake-bo';
import {
  appendEvent,
  bookingsCollection,
  BOOKINGS_COLLECTION,
  claimCharge,
  createBookingState,
  END_OF_CYCLE_TTL_SECONDS,
  listFleetDocs,
  listPendingRegularizations,
  mapStorageError,
  MAX_EVENTS,
  MAX_FLEET_PAGES,
  readBookingState,
  releaseCharge,
  startExpiry,
  stopExpiry,
  StorageRequestError,
  updateBookingState,
  withEvent,
  MONEY_EVENT_TYPES,
  type BookingEvent,
  type BookingStateDoc,
  type BookingStateCollection,
} from './booking-state';

const BOOKING = 'b6d1c0de-0000-4000-8000-000000000001';
const now = new Date('2026-03-10T08:00:00.000Z');

let bo: ReturnType<typeof fakeBo>;
let collection: BookingStateCollection;
let disconnect: () => void;

beforeEach(async () => {
  bo = fakeBo();
  const client = await connect({ vulogBo: bo.api });
  disconnect = () => client.disconnect();
  collection = bookingsCollection(client.storage);
});

afterEach(() => {
  disconnect();
  vi.restoreAllMocks();
});

const stored = (id = BOOKING) => bo.storage.docs(BOOKINGS_COLLECTION).get(id);
const seed = async (value: Record<string, unknown>, id = BOOKING) =>
  bo.storage.api.set(BOOKINGS_COLLECTION, id, {
    schemaVersion: 1,
    fleetId: 'FLEET-1',
    allocationProcessed: false,
    ...value,
  });
const event = (index: number): BookingEvent => ({
  at: new Date(now.getTime() + index * 1000).toISOString(),
  by: 'user-1',
  type: `event-${index}`,
});

describe('mapStorageError', () => {
  it.each([
    [new BoError('INTERNAL', 'x', { reason: 'version-conflict', status: 409 }), 'conflict'],
    [new BoError('INTERNAL', 'x', { reason: 'already-exists', status: 409 }), 'conflict'],
    [new BoError('INTERNAL', 'x', { reason: 'not-found', status: 404 }), 'not-found'],
    [new BoError('INTERNAL', 'x', { reason: 'quota-exceeded', status: 422 }), 'quota-exceeded'],
    [new BoError('INTERNAL', 'x', { reason: 'rate-limited', status: 429 }), 'rate-limited'],
    [new BoError('INTERNAL', 'x', { reason: 'disposed' }), 'disposed'],
    [new BoError('INTERNAL', 'x', { reason: 'ERR_NETWORK' }), 'unknown-outcome'],
    [new BoError('INTERNAL', 'x', { reason: 'ECONNABORTED' }), 'unknown-outcome'],
    [new BoError('INTERNAL', 'x'), 'unknown-outcome'],
    [new BoError('TIMEOUT', 'x'), 'unknown-outcome'],
    [new BoError('DISCONNECTED', 'x'), 'unknown-outcome'],
    [new BoError('FORBIDDEN', 'x'), 'forbidden'],
    [new BoError('INTERNAL', 'x', { reason: 'value-too-large', status: 413 }), 'too-large'],
    [new BoError('INTERNAL', 'x', { reason: 'invalid-cursor', status: 400 }), 'failed'],
    [new BoError('INTERNAL', 'x', { status: 500 }), 'failed'],
    [new BoError('INTERNAL', 'x', { reason: 'not-installed', status: 404 }), 'not-installed'],
    [new BoError('INVALID_PAYLOAD', 'x'), 'failed'],
    [new BoError('UNKNOWN_TYPE', 'x'), 'unsupported'],
  ])('maps %s to %s', (error, kind) => {
    expect(mapStorageError(error).kind).toBe(kind);
  });

  it('rethrows what is not a BoError', () => {
    const bug = new TypeError('bug');
    expect(() => mapStorageError(bug)).toThrow(bug);
  });
});

describe('readBookingState', () => {
  it('gives null when there is no document', async () => {
    expect(await readBookingState(collection, BOOKING)).toEqual({ ok: true, value: null });
  });

  it('gives the document, its version and its expiry', async () => {
    await seed({ internalNotes: 'Call before' });
    const result = await readBookingState(collection, BOOKING);
    expect(result).toEqual({
      ok: true,
      value: {
        id: BOOKING,
        version: 1,
        expiresAt: null,
        value: {
          schemaVersion: 1,
          fleetId: 'FLEET-1',
          allocationProcessed: false,
          internalNotes: 'Call before',
        },
      },
    });
  });

  it('keeps the fields it does not know', async () => {
    await seed({ futureField: 1 });
    const result = await readBookingState(collection, BOOKING);
    expect(result.ok && result.value?.value).toMatchObject({ futureField: 1 });
  });

  it('refuses a document of another contract version', async () => {
    await seed({ schemaVersion: 2 });
    const result = await readBookingState(collection, BOOKING);
    expect(result.ok === false && result.error).toMatchObject({
      kind: 'invalid-document',
      id: BOOKING,
    });
  });

  it('refuses a document that breaks a rule between fields', async () => {
    await seed({ invoiceId: 'invoice-1' });
    const result = await readBookingState(collection, BOOKING);
    expect(result.ok === false && result.error).toMatchObject({ kind: 'invalid-document' });
  });

  it('refuses a document whose journal is too long', async () => {
    await seed({ events: Array.from({ length: MAX_EVENTS + 1 }, (_, index) => event(index)) });
    const result = await readBookingState(collection, BOOKING);
    expect(result.ok === false && result.error.kind).toBe('invalid-document');
  });

  it('maps a refusal of the back office', async () => {
    bo.storage.api.get.mockRejectedValueOnce(hostError('rate-limited', 429));
    expect(await readBookingState(collection, BOOKING)).toEqual({
      ok: false,
      error: { kind: 'rate-limited' },
    });
  });
});

describe('createBookingState', () => {
  it('creates the document with allocationProcessed false and no expiry, only if absent', async () => {
    const result = await createBookingState(collection, BOOKING, {
      fleetId: 'FLEET-1',
      patch: { internalNotes: 'Call before' },
    });

    expect(result.ok && result.value.version).toBe(1);
    expect(bo.storage.api.set).toHaveBeenCalledWith(
      BOOKINGS_COLLECTION,
      BOOKING,
      {
        schemaVersion: 1,
        fleetId: 'FLEET-1',
        allocationProcessed: false,
        internalNotes: 'Call before',
      },
      { ifVersion: 0 },
    );
    expect(stored()?.value).toHaveProperty('allocationProcessed', false);
    expect(stored()?.expiresAt).toBeUndefined();
  });

  it('gives conflict when the document exists', async () => {
    await seed({});
    expect(await createBookingState(collection, BOOKING, { fleetId: 'FLEET-1' })).toEqual({
      ok: false,
      error: { kind: 'conflict' },
    });
  });

  it('refuses an invalid value without writing', async () => {
    const result = await createBookingState(collection, BOOKING, {
      fleetId: 'FLEET-1',
      patch: { internalNotes: 'x'.repeat(501) },
    });
    expect(result.ok === false && result.error.kind).toBe('invalid-write');
    expect(bo.storage.api.set).not.toHaveBeenCalled();
  });

  it('refuses an unknown field, a scheduler field or a broken rule, as an update would', async () => {
    for (const patch of [
      { refundedAT: now.toISOString() },
      { allocationProcessed: true },
      { fleetId: 'FLEET-2' },
      { invoiceId: 'invoice-1' },
    ]) {
      const result = await createBookingState(collection, BOOKING, {
        fleetId: 'FLEET-1',
        patch: patch as never,
      });
      expect(result.ok === false && result.error.kind).toBe('invalid-write');
    }
    expect(bo.storage.api.set).not.toHaveBeenCalled();
  });

  it('gives the failure of the back office', async () => {
    bo.storage.api.set.mockRejectedValueOnce(hostError('quota-exceeded', 422));
    expect(await createBookingState(collection, BOOKING, { fleetId: 'FLEET-1' })).toEqual({
      ok: false,
      error: { kind: 'quota-exceeded' },
    });
  });
});

/** The stored document, read through the helpers. */
const current = async (id = BOOKING): Promise<BookingStateDoc> => {
  const read = await readBookingState(collection, id);
  if (!read.ok || read.value === null) throw new Error('no document');
  return read.value;
};

describe('updateBookingState', () => {
  it('merges the patch over the version read, without touching the expiry', async () => {
    await seed({ internalNotes: 'a', chargeStartedAt: now.toISOString() });
    await startExpiry(collection, await current(), { refundedAt: now.toISOString() });
    const expiresAt = stored()?.expiresAt;

    const result = await updateBookingState(collection, await current(), { internalNotes: 'b' });

    expect(result.ok && result.value.value).toMatchObject({
      internalNotes: 'b',
      refundedAt: now.toISOString(),
    });
    expect(bo.storage.api.update).toHaveBeenLastCalledWith(
      BOOKINGS_COLLECTION,
      BOOKING,
      { internalNotes: 'b' },
      { ifVersion: 2 },
    );
    expect(stored()?.expiresAt).toBe(expiresAt);
  });

  it('gives not-found when the document is gone, and never recreates it', async () => {
    await seed({});
    const doc = await current();
    bo.storage.docs(BOOKINGS_COLLECTION).clear();
    expect(await updateBookingState(collection, doc, { internalNotes: 'b' })).toEqual({
      ok: false,
      error: { kind: 'not-found' },
    });
    expect(stored()).toBeUndefined();
  });

  it('gives conflict when written meanwhile', async () => {
    await seed({});
    const stale = await current();
    await updateBookingState(collection, stale, { internalNotes: 'a' });
    expect(await updateBookingState(collection, stale, { internalNotes: 'b' })).toEqual({
      ok: false,
      error: { kind: 'conflict' },
    });
  });

  it('refuses the fleet, the contract version, a scheduler field or an unknown field', async () => {
    await seed({});
    const doc = await current();
    for (const patch of [
      { fleetId: 'FLEET-2' },
      { schemaVersion: 2 },
      { allocationProcessed: true },
      { creditsAdded: true },
      { walletId: 'wallet-1' },
      { schedulerErrors: {} },
      { unknownField: true },
    ]) {
      const result = await updateBookingState(collection, doc, patch as never);
      expect(result.ok === false && result.error.kind).toBe('invalid-write');
    }
    expect(bo.storage.api.update).not.toHaveBeenCalled();
  });

  it('refuses a patch that breaks a rule between fields once merged', async () => {
    await seed({});
    const doc = await current();
    for (const patch of [
      { invoiceId: 'invoice-1' },
      { regularizationPending: true },
      { regularizedAt: now.toISOString() },
      { refundOutcome: 'in-doubt' as const },
      { feeOutcome: 'in-doubt' as const },
      { feeOutcome: 'unknown' },
      { refundAmount: -1 },
      { refundStartedAt: 'not a date', refundOutcome: 'in-doubt' },
      { refundStartedAt: now.toISOString() },
      { feeStartedAt: now.toISOString() },
      { feeStartedAt: now.toISOString(), feeOutcome: 'charged' },
      { feeInvoiceId: 'fee-1' },
      { refundDecidedAt: now.toISOString() },
      { feeDecidedAt: now.toISOString(), feeDecidedBy: '' },
      { chargeAcceptedAt: now.toISOString() },
    ]) {
      const result = await updateBookingState(collection, doc, patch as never);
      expect(result.ok === false && result.error.kind).toBe('invalid-write');
    }
    expect(bo.storage.api.update).not.toHaveBeenCalled();
  });

  it('writes the fields of a money step with their start', async () => {
    await seed({});
    const doc = await current();
    const written = await updateBookingState(collection, doc, {
      refundStartedAt: now.toISOString(),
      refundStartedBy: 'user-1',
      refundAmount: 50,
      refundOutcome: 'in-doubt',
    });
    expect(written.ok && written.value.value).toMatchObject({ refundOutcome: 'in-doubt', refundAmount: 50 });
  });

  it('keeps refusing a merged rule break', async () => {
    await seed({});
    const doc = await current();
    for (const patch of [{ invoiceId: 'invoice-1' }]) {
      const result = await updateBookingState(collection, doc, patch);
      expect(result.ok === false && result.error.kind).toBe('invalid-write');
    }
    expect(bo.storage.api.update).not.toHaveBeenCalled();
  });
});

describe('startExpiry and stopExpiry', () => {
  it('starts the 365-day expiry with the final fields, in one write', async () => {
    await seed({});
    const result = await startExpiry(collection, await current(), {
      refundedAt: now.toISOString(),
    });

    expect(bo.storage.api.update).toHaveBeenCalledWith(
      BOOKINGS_COLLECTION,
      BOOKING,
      { refundedAt: now.toISOString() },
      { ifVersion: 1, ttlSeconds: END_OF_CYCLE_TTL_SECONDS },
    );
    expect(result.ok && result.value.expiresAt).toBe('2027-01-01T00:00:00.000Z');
  });

  it('removes the expiry when the cycle reopens', async () => {
    await seed({ toRegularize: { missingAmount: 12, at: now.toISOString() } });
    await startExpiry(collection, await current(), {
      regularizedAt: now.toISOString(),
      regularizedBy: 'user-1',
      regularizationPending: false,
    });

    const result = await stopExpiry(collection, await current(), {
      regularizedAt: null,
      regularizedBy: null,
      regularizationNote: null,
      regularizationPending: true,
    });

    expect(bo.storage.api.update).toHaveBeenLastCalledWith(
      BOOKINGS_COLLECTION,
      BOOKING,
      {
        regularizedAt: null,
        regularizedBy: null,
        regularizationNote: null,
        regularizationPending: true,
      },
      { ifVersion: 2, ttlSeconds: null },
    );
    expect(result.ok && result.value.expiresAt).toBeNull();
  });

  it('gives not-found for a document that is gone', async () => {
    await seed({});
    const doc = await current();
    bo.storage.docs(BOOKINGS_COLLECTION).clear();
    expect(await startExpiry(collection, doc, { refundedAt: now.toISOString() })).toEqual({
      ok: false,
      error: { kind: 'not-found' },
    });
  });
});

describe('claimCharge', () => {
  const input = { fleetId: 'FLEET-1', userId: 'user-1', now };

  it('creates the document with the claim when there is none', async () => {
    const result = await claimCharge(collection, BOOKING, input);

    expect(result.ok && result.value.value).toEqual({
      schemaVersion: 1,
      fleetId: 'FLEET-1',
      allocationProcessed: false,
      chargeStartedAt: now.toISOString(),
      chargeStartedBy: 'user-1',
      chargeAcceptedAt: null,
      events: [{ at: now.toISOString(), by: 'user-1', type: 'charge-started' }],
    });
    expect(bo.storage.api.set.mock.calls[0]?.[3]).toEqual({ ifVersion: 0 });
  });

  it('writes the claim over the version read when the document exists', async () => {
    await seed({ internalNotes: 'Call before', events: [event(0)] });

    const result = await claimCharge(collection, BOOKING, input);

    expect(bo.storage.api.update).toHaveBeenCalledWith(
      BOOKINGS_COLLECTION,
      BOOKING,
      {
        chargeStartedAt: now.toISOString(),
        chargeStartedBy: 'user-1',
        chargeAcceptedAt: null,
        events: [event(0), { at: now.toISOString(), by: 'user-1', type: 'charge-started' }],
      },
      { ifVersion: 1 },
    );
    expect(result.ok && result.value.value.internalNotes).toBe('Call before');
  });

  it('writes the amounts and the entity of the charge with the claim, in one write', async () => {
    const result = await claimCharge(collection, BOOKING, {
      ...input,
      patch: { chargeAmount: 42, computedAmount: 40, amountWarnings: ['above-computed'], entityId: 'entity-1', isB2B: false },
    });

    expect(result.ok && result.value.value).toMatchObject({
      chargeStartedAt: now.toISOString(),
      chargeAmount: 42,
      computedAmount: 40,
      amountWarnings: ['above-computed'],
      entityId: 'entity-1',
      isB2B: false,
    });
    expect(bo.storage.api.set).toHaveBeenCalledOnce();
  });

  it('keeps a null operator id', async () => {
    const result = await claimCharge(collection, BOOKING, { ...input, userId: null });
    expect(result.ok && result.value.value.chargeStartedBy).toBeNull();
  });

  it('says already in progress, by whom, when a claim exists', async () => {
    await seed({ chargeStartedAt: now.toISOString(), chargeStartedBy: 'user-2' });
    expect(await claimCharge(collection, BOOKING, input)).toEqual({
      ok: false,
      error: { kind: 'already-in-progress', startedAt: now.toISOString(), startedBy: 'user-2' },
    });
    expect(bo.storage.api.update).not.toHaveBeenCalled();
  });

  it('says already charged when an invoice exists', async () => {
    await seed({ chargeStartedAt: now.toISOString(), invoiceId: 'invoice-1' });
    expect(await claimCharge(collection, BOOKING, input)).toEqual({
      ok: false,
      error: { kind: 'already-charged', invoiceId: 'invoice-1' },
    });
  });

  it('says already in progress when another operator claimed meanwhile', async () => {
    bo.storage.api.set.mockImplementationOnce(async () => {
      await seed({ chargeStartedAt: now.toISOString(), chargeStartedBy: 'user-2' });
      throw hostError('already-exists', 409);
    });
    expect(await claimCharge(collection, BOOKING, input)).toEqual({
      ok: false,
      error: { kind: 'already-in-progress', startedAt: now.toISOString(), startedBy: 'user-2' },
    });
  });

  it('claims after reading again when another field changed meanwhile', async () => {
    await seed({});
    bo.storage.api.update.mockImplementationOnce(async () => {
      bo.storage.docs(BOOKINGS_COLLECTION).get(BOOKING)!.version = 2;
      throw hostError('version-conflict', 409);
    });

    const result = await claimCharge(collection, BOOKING, input);

    expect(result.ok && result.value.value.chargeStartedBy).toBe('user-1');
    expect(bo.storage.api.update.mock.calls.at(-1)?.[3]).toEqual({ ifVersion: 2 });
  });

  it('gives conflict when the document keeps changing', async () => {
    await seed({});
    bo.storage.api.update.mockRejectedValue(hostError('version-conflict', 409));
    expect(await claimCharge(collection, BOOKING, input)).toEqual({
      ok: false,
      error: { kind: 'conflict' },
    });
    expect(bo.storage.api.update).toHaveBeenCalledTimes(3);
  });

  it('gives the failure of the read', async () => {
    bo.storage.api.get.mockRejectedValueOnce(hostError('quota-exceeded', 422));
    expect(await claimCharge(collection, BOOKING, input)).toEqual({
      ok: false,
      error: { kind: 'quota-exceeded' },
    });
  });

  it('gives an unknown outcome when the write gets no answer', async () => {
    bo.storage.api.set.mockRejectedValueOnce(
      Object.assign(new Error('timeout'), { code: 'TIMEOUT' }),
    );
    const result = await claimCharge(collection, BOOKING, input);
    expect(result.ok === false && result.error.kind).toBe('unknown-outcome');
  });
});

describe('releaseCharge', () => {
  const input = { userId: 'user-1', now };

  it('never releases a claim the API accepted', async () => {
    await seed({ chargeStartedAt: now.toISOString(), chargeAcceptedAt: now.toISOString() });

    expect(await releaseCharge(collection, await current(), input)).toEqual({ ok: false, error: { kind: 'charge-accepted' } });
    expect(bo.storage.api.update).not.toHaveBeenCalled();
  });

  it('clears the claim and records it in the journal', async () => {
    await claimCharge(collection, BOOKING, { ...input, fleetId: 'FLEET-1' });

    const result = await releaseCharge(collection, await current(), input);

    expect(result.ok && result.value.value).toMatchObject({
      chargeStartedAt: null,
      chargeStartedBy: null,
    });
    expect(result.ok && result.value.value.events?.map((entry) => entry.type)).toEqual([
      'charge-started',
      'charge-released',
    ]);
  });

  it('clears the amounts written with the claim', async () => {
    await claimCharge(collection, BOOKING, {
      ...input,
      fleetId: 'FLEET-1',
      patch: { chargeAmount: 42, computedAmount: null, amountWarnings: ['below-minimum'], entityId: 'entity-1', isB2B: false },
    });

    const result = await releaseCharge(collection, await current(), input);

    expect(result.ok && result.value.value).toMatchObject({
      chargeAmount: null,
      computedAmount: null,
      amountWarnings: [],
      entityId: 'entity-1',
    });
  });

  it('refuses once an invoice is known', async () => {
    await seed({ chargeStartedAt: now.toISOString(), invoiceId: 'invoice-1' });
    expect(await releaseCharge(collection, await current(), input)).toEqual({
      ok: false,
      error: { kind: 'already-charged', invoiceId: 'invoice-1' },
    });
    expect(bo.storage.api.update).not.toHaveBeenCalled();
  });

  it('gives conflict when written meanwhile', async () => {
    await seed({ chargeStartedAt: now.toISOString() });
    const stale = await current();
    await appendEvent(collection, BOOKING, event(0));
    expect(await releaseCharge(collection, stale, input)).toEqual({
      ok: false,
      error: { kind: 'conflict' },
    });
  });
});

describe('withEvent', () => {
  it('appends an entry without changing the journal given', () => {
    const events = [event(0)];
    expect(withEvent(events, event(1))).toEqual([event(0), event(1)]);
    expect(events).toEqual([event(0)]);
  });

  it('starts a journal', () => {
    expect(withEvent(undefined, event(0))).toEqual([event(0)]);
  });

  it('keeps the 50 newest entries', () => {
    const events = Array.from({ length: MAX_EVENTS }, (_, index) => event(index));
    const result = withEvent(events, event(MAX_EVENTS));
    expect(result).toHaveLength(MAX_EVENTS);
    expect(result[0]).toEqual(event(1));
    expect(result.at(-1)).toEqual(event(MAX_EVENTS));
  });

  it('drops the other entries before the money steps when full', () => {
    expect(MONEY_EVENT_TYPES.has('cancellation-fee-started')).toBe(true);
    const money = { ...event(0), type: 'cancellation-fee-started' };
    const events = [money, ...Array.from({ length: MAX_EVENTS - 1 }, (_, index) => event(index + 1))];
    const result = withEvent(events, event(MAX_EVENTS));
    expect(result).toHaveLength(MAX_EVENTS);
    expect(result[0]).toEqual(money);
    expect(result[1]).toEqual(event(2));
  });

  it('drops a new note rather than a money step when the journal is full of them', () => {
    const events = Array.from({ length: MAX_EVENTS }, (_, index) => ({ ...event(index), type: 'refunded' }));
    expect(withEvent(events, event(MAX_EVENTS))).toEqual(events);
  });

  it('drops an old note for a new money step', () => {
    const note = event(0);
    const money = Array.from({ length: MAX_EVENTS - 1 }, (_, index) => ({ ...event(index + 1), type: 'refunded' }));
    const added = { ...event(MAX_EVENTS), type: 'cancellation-fee-started' };
    const result = withEvent([note, ...money], added);
    expect(result).toEqual([...money, added]);
  });

  it('never drops an unresolved started entry: the write is refused instead', async () => {
    const started = Array.from({ length: MAX_EVENTS }, (_, index) => ({ ...event(index), type: 'refund-started' }));
    const result = withEvent(started, { ...event(MAX_EVENTS), type: 'cancellation-fee-started' });
    expect(result).toHaveLength(MAX_EVENTS + 1);
    expect(result.slice(0, MAX_EVENTS)).toEqual(started);
    await seed({ events: started });
    const written = await updateBookingState(collection, await current(), { events: result });
    expect(written).toMatchObject({ ok: false, error: { kind: 'invalid-write' } });
  });
});

describe('appendEvent', () => {
  it('adds the entry over the version read', async () => {
    await seed({ events: [event(0)] });
    const result = await appendEvent(collection, BOOKING, event(1));
    expect(result.ok && result.value.value.events).toEqual([event(0), event(1)]);
    expect(bo.storage.api.update.mock.calls[0]?.[3]).toEqual({ ifVersion: 1 });
  });

  it('keeps the 50 newest entries', async () => {
    await seed({ events: Array.from({ length: MAX_EVENTS }, (_, index) => event(index)) });
    const result = await appendEvent(collection, BOOKING, event(MAX_EVENTS));
    expect(result.ok && result.value.value.events?.[0]).toEqual(event(1));
  });

  it('gives not-found without a document', async () => {
    expect(await appendEvent(collection, BOOKING, event(0))).toEqual({
      ok: false,
      error: { kind: 'not-found' },
    });
  });

  it('gives conflict when written meanwhile', async () => {
    await seed({});
    bo.storage.api.update.mockRejectedValueOnce(hostError('version-conflict', 409));
    expect(await appendEvent(collection, BOOKING, event(0))).toEqual({
      ok: false,
      error: { kind: 'conflict' },
    });
  });

  it('refuses an invalid entry', async () => {
    await seed({});
    const result = await appendEvent(collection, BOOKING, { at: 'yesterday', by: null, type: 'x' });
    expect(result.ok === false && result.error.kind).toBe('invalid-write');
  });

  it('gives the failure of the read', async () => {
    bo.storage.api.get.mockRejectedValueOnce(hostError('rate-limited', 429));
    expect(await appendEvent(collection, BOOKING, event(0))).toEqual({
      ok: false,
      error: { kind: 'rate-limited' },
    });
  });
});

describe('listFleetDocs', () => {
  it('reads every page of the documents of the fleet', async () => {
    for (let index = 0; index < 205; index++)
      await seed({}, `booking-${String(index).padStart(3, '0')}`);
    await bo.storage.api.set(BOOKINGS_COLLECTION, 'other-fleet', {
      schemaVersion: 1,
      fleetId: 'FLEET-2',
      allocationProcessed: false,
    });

    const result = await listFleetDocs(collection, 'FLEET-1');

    expect(result.ok && result.value.docs).toHaveLength(205);
    expect(result.ok && result.value.invalid).toEqual([]);
    expect(bo.storage.api.query).toHaveBeenCalledTimes(3);
    expect(bo.storage.api.query.mock.calls[0]?.[1]).toEqual({
      where: { fleetId: 'FLEET-1' },
      limit: 100,
    });
    expect(bo.storage.api.query.mock.calls[1]?.[1]).toEqual({
      where: { fleetId: 'FLEET-1' },
      limit: 100,
      cursor: '100',
    });
  });

  it('keeps reading after an empty page whose cursor is not null', async () => {
    await seed({});
    bo.storage.api.query.mockResolvedValueOnce({ items: [], nextCursor: '0' });
    const result = await listFleetDocs(collection, 'FLEET-1');
    expect(result.ok && result.value.docs.map((doc) => doc.id)).toEqual([BOOKING]);
  });

  it('lists the documents that break the contract apart', async () => {
    await seed({});
    await seed({ schemaVersion: 9 }, 'broken');
    const result = await listFleetDocs(collection, 'FLEET-1');
    expect(result.ok && result.value.docs.map((doc) => doc.id)).toEqual([BOOKING]);
    expect(result.ok && result.value.invalid.map((doc) => doc.id)).toEqual(['broken']);
  });

  it('gives no document for an empty fleet', async () => {
    expect(await listFleetDocs(collection, 'FLEET-1')).toEqual({
      ok: true,
      value: { docs: [], invalid: [] },
    });
  });

  it('gives the failure of a page', async () => {
    bo.storage.api.query.mockRejectedValueOnce(hostError('rate-limited', 429));
    expect(await listFleetDocs(collection, 'FLEET-1')).toEqual({
      ok: false,
      error: { kind: 'rate-limited' },
    });
  });

  it('stops after the most pages it reads', async () => {
    bo.storage.api.query.mockResolvedValue({ items: [], nextCursor: 'again' });
    const result = await listFleetDocs(collection, 'FLEET-1');
    expect(result).toEqual({ ok: false, error: { kind: 'too-many-pages' } });
    expect(bo.storage.api.query).toHaveBeenCalledTimes(MAX_FLEET_PAGES);
  });

  it('gives no partial result when a later page fails', async () => {
    for (let index = 0; index < 150; index++) await seed({}, `booking-${index}`);
    bo.storage.api.query.mockImplementationOnce(async () => ({ items: [], nextCursor: '0' }));
    bo.storage.api.query.mockRejectedValueOnce(hostError('rate-limited', 429));
    expect(await listFleetDocs(collection, 'FLEET-1')).toEqual({
      ok: false,
      error: { kind: 'rate-limited' },
    });
  });
});

describe('StorageRequestError', () => {
  it('carries the failure', () => {
    const error = new StorageRequestError({ kind: 'rate-limited' });
    expect(error.failure).toEqual({ kind: 'rate-limited' });
    expect(error.message).toBe('Booking state storage: rate-limited');
    expect(error.cause).toBeUndefined();
  });

  it('gives the details and the cause of the failure', () => {
    const cause = new BoError('INTERNAL', 'no answer', { reason: 'ERR_NETWORK' });
    const error = new StorageRequestError({ kind: 'unknown-outcome', error: cause });
    expect(error.message).toBe('Booking state storage: unknown-outcome (no answer)');
    expect(error.cause).toBe(cause);
    expect(
      new StorageRequestError({
        kind: 'invalid-document',
        id: 'b-1',
        issues: ['fleetId: Required'],
      }).message,
    ).toBe('Booking state storage: invalid-document (b-1: fleetId: Required)');
    expect(
      new StorageRequestError({ kind: 'invalid-write', issues: ['x: bad'] }).message,
    ).toContain('x: bad');
  });
});

describe('listPendingRegularizations', () => {
  const pending = { toRegularize: { missingAmount: 5, at: now.toISOString() }, regularizationPending: true };

  it('queries the documents of the fleet with a regularization to do only', async () => {
    await seed(pending, 'booking-a');
    await seed({ ...pending, regularizationPending: false }, 'booking-b');
    await seed({}, 'booking-c');
    await bo.storage.api.set(BOOKINGS_COLLECTION, 'booking-d', { schemaVersion: 1, fleetId: 'FLEET-2', allocationProcessed: false, ...pending });

    const result = await listPendingRegularizations(collection, 'FLEET-1');

    expect(result.ok && result.value.docs.map((doc) => doc.id)).toEqual(['booking-a']);
    expect(bo.storage.api.query.mock.calls[0]?.[1]).toMatchObject({ where: { fleetId: 'FLEET-1', regularizationPending: true } });
  });

  it('gives the failure of a page', async () => {
    bo.storage.api.query.mockRejectedValueOnce(hostError('rate-limited', 429));
    expect(await listPendingRegularizations(collection, 'FLEET-1')).toEqual({ ok: false, error: { kind: 'rate-limited' } });
  });
});
