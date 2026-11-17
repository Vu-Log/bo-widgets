import { connect, type AuthFetch } from '@vulog/bo-widget-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bookingsCollection, BOOKINGS_COLLECTION, createBookingState } from '../../storage/booking-state';
import { fakeBo, hostError } from '../../test/fake-bo';
import { allocate, cancel, preallocate, removePreallocation, type WriteDeps } from './operations';

const disconnects: (() => void)[] = [];
afterEach(() => disconnects.splice(0).forEach((disconnect) => disconnect()));

/** The calls the fake API received, as `METHOD path`; `fail` makes the matching calls fail. */
async function setup(options: { fail?: (call: string) => number | undefined; reasons?: Record<string, string | null> } = {}) {
  const bo = fakeBo();
  const client = await connect({ vulogBo: bo.api });
  disconnects.push(() => client.disconnect());
  const calls: string[] = [];
  const authFetch = vi.fn<AuthFetch>(async (path, init) => {
    const call = `${init?.method ?? 'GET'} ${String(path)}`;
    calls.push(call);
    const status = options.fail?.(call);
    return new Response(null, { status: status ?? 200 });
  });
  const collection = bookingsCollection(client.storage);
  const deps: WriteDeps = {
    authFetch,
    collection,
    fleetId: 'FLEET-1',
    userId: 'user-9',
    now: () => new Date('2026-03-10T08:00:00Z'),
    reasonOf: async (vehicleId) => options.reasons?.[vehicleId] ?? null,
  };
  const stored = () => bo.storage.docs(BOOKINGS_COLLECTION).get('booking-1')?.value;
  return { bo, deps, calls, collection, stored };
}

const fleet = 'fleetmanager/public/fleets/FLEET-1/vehicles';
const reasonFor = 'Schedule a trip booking-1';

describe('preallocate', () => {
  it('puts the vehicle out of service, then creates the stored state', async () => {
    const { deps, calls, stored } = await setup();
    const result = await preallocate(deps, 'booking-1', { id: 'v-1', plate: 'AB-123-CD' });
    expect(result).toMatchObject({ ok: true, warnings: [] });
    expect(calls).toEqual([`POST ${fleet}/v-1/disable`]);
    expect(stored()).toMatchObject({
      fleetId: 'FLEET-1',
      allocationProcessed: false,
      preallocatedVehicleId: 'v-1',
      preallocatedPlate: 'AB-123-CD',
      events: [{ at: '2026-03-10T08:00:00.000Z', by: 'user-9', type: 'preallocated', details: { vehicleId: 'v-1', previousVehicleId: null } }],
    });
  });

  it('frees the previous vehicle when it is still held for the booking', async () => {
    const { deps, calls, stored, collection } = await setup({ reasons: { 'v-1': reasonFor } });
    await createBookingState(collection, 'booking-1', { fleetId: 'FLEET-1', patch: { preallocatedVehicleId: 'v-1' } });
    const result = await preallocate(deps, 'booking-1', { id: 'v-2', plate: null });
    expect(result).toMatchObject({ ok: true, warnings: [] });
    expect(calls).toEqual([`POST ${fleet}/v-2/disable`, `POST ${fleet}/v-1/enable`]);
    expect(stored()?.preallocatedVehicleId).toBe('v-2');
  });

  it('leaves a previous vehicle held for something else, and warns', async () => {
    const { deps, calls, collection } = await setup({ reasons: { 'v-1': 'Repair' } });
    await createBookingState(collection, 'booking-1', { fleetId: 'FLEET-1', patch: { preallocatedVehicleId: 'v-1' } });
    const result = await preallocate(deps, 'booking-1', { id: 'v-2', plate: null });
    expect(result).toMatchObject({ ok: true, warnings: [{ kind: 'vehicle-held-elsewhere', vehicleId: 'v-1' }] });
    expect(calls).toEqual([`POST ${fleet}/v-2/disable`]);
  });

  it('warns when the previous vehicle cannot be put back in service', async () => {
    const { deps, collection } = await setup({
      reasons: { 'v-1': reasonFor },
      fail: (call) => (call.endsWith('v-1/enable') ? 500 : undefined),
    });
    await createBookingState(collection, 'booking-1', { fleetId: 'FLEET-1', patch: { preallocatedVehicleId: 'v-1' } });
    expect(await preallocate(deps, 'booking-1', { id: 'v-2', plate: null })).toMatchObject({
      ok: true,
      warnings: [{ kind: 'vehicle-not-enabled', vehicleId: 'v-1' }],
    });
  });

  it('does nothing for the vehicle already pre-allocated', async () => {
    const { deps, calls, collection } = await setup();
    await createBookingState(collection, 'booking-1', { fleetId: 'FLEET-1', patch: { preallocatedVehicleId: 'v-1' } });
    expect((await preallocate(deps, 'booking-1', { id: 'v-1', plate: null })).ok).toBe(true);
    expect(calls).toEqual([]);
  });

  it('refuses once the scheduler handled the booking', async () => {
    const { deps, calls, bo } = await setup();
    await bo.storage.api.set(BOOKINGS_COLLECTION, 'booking-1', { schemaVersion: 1, fleetId: 'FLEET-1', allocationProcessed: true });
    expect(await preallocate(deps, 'booking-1', { id: 'v-1', plate: null })).toEqual({
      ok: false,
      failure: { kind: 'already-processed' },
    });
    expect(calls).toEqual([]);
  });

  it('keeps the state when the vehicle cannot be put out of service', async () => {
    const { deps, stored } = await setup({ fail: () => 409 });
    expect(await preallocate(deps, 'booking-1', { id: 'v-1', plate: null })).toEqual({
      ok: false,
      failure: { kind: 'api', error: { kind: 'http', status: 409 } },
    });
    expect(stored()).toBeUndefined();
  });

  it('puts the vehicle back in service when the state cannot be written', async () => {
    const { deps, calls, bo } = await setup();
    bo.storage.api.set.mockRejectedValueOnce(hostError('quota-exceeded', 507));
    const result = await preallocate(deps, 'booking-1', { id: 'v-1', plate: null });
    expect(result).toEqual({ ok: false, failure: { kind: 'storage', error: { kind: 'quota-exceeded' } } });
    expect(calls).toEqual([`POST ${fleet}/v-1/disable`, `POST ${fleet}/v-1/enable`]);
  });

  it('says when the vehicle could not be put back in service either', async () => {
    const { deps, bo } = await setup({ fail: (call) => (call.endsWith('/enable') ? 500 : undefined) });
    bo.storage.api.set.mockRejectedValueOnce(hostError('quota-exceeded', 507));
    expect(await preallocate(deps, 'booking-1', { id: 'v-1', plate: null })).toEqual({
      ok: false,
      failure: { kind: 'rollback-failed', vehicleId: 'v-1', error: { kind: 'http', status: 500 } },
    });
  });

  it('fails when the state cannot be read', async () => {
    const { deps, bo, calls } = await setup();
    bo.storage.api.get.mockRejectedValueOnce(hostError('rate-limited', 429));
    const result = await preallocate(deps, 'booking-1', { id: 'v-1', plate: null });
    expect(result).toEqual({ ok: false, failure: { kind: 'storage', error: { kind: 'rate-limited' } } });
    expect(calls).toEqual([]);
  });
});

describe('removePreallocation', () => {
  it('frees the vehicle and clears the state', async () => {
    const { deps, calls, collection, stored } = await setup({ reasons: { 'v-1': reasonFor } });
    await createBookingState(collection, 'booking-1', { fleetId: 'FLEET-1', patch: { preallocatedVehicleId: 'v-1', preallocatedPlate: 'P' } });
    expect(await removePreallocation(deps, 'booking-1')).toMatchObject({ ok: true, warnings: [] });
    expect(calls).toEqual([`POST ${fleet}/v-1/enable`]);
    expect(stored()).toMatchObject({ preallocatedVehicleId: null, preallocatedPlate: null });
    expect((stored()?.events as { type: string }[]).at(-1)?.type).toBe('preallocation-removed');
  });

  it('does nothing without state, and refuses once handled by the scheduler', async () => {
    const { deps, bo } = await setup();
    expect(await removePreallocation(deps, 'booking-1')).toEqual({ ok: true, state: null, warnings: [] });
    await bo.storage.api.set(BOOKINGS_COLLECTION, 'booking-1', { schemaVersion: 1, fleetId: 'FLEET-1', allocationProcessed: true, preallocatedVehicleId: 'v-1' });
    expect(await removePreallocation(deps, 'booking-1')).toEqual({ ok: false, failure: { kind: 'already-processed' } });
  });

  it('warns when the state cannot be cleared', async () => {
    const { deps, collection, bo } = await setup({ reasons: { 'v-1': reasonFor } });
    await createBookingState(collection, 'booking-1', { fleetId: 'FLEET-1', patch: { preallocatedVehicleId: 'v-1' } });
    bo.storage.api.update.mockRejectedValueOnce(hostError('version-conflict', 409));
    expect(await removePreallocation(deps, 'booking-1')).toMatchObject({
      ok: true,
      warnings: [{ kind: 'state-not-updated', error: { kind: 'conflict' } }],
    });
  });
});

describe('allocate', () => {
  const booking = { id: 'booking-1', serviceId: 'service-1' };
  const allocatePath = (vehicleId: string) =>
    `POST user/scheduleATrip/fleets/FLEET-1/bookingrequests/booking-1/allocate/${vehicleId}?serviceId=service-1`;

  it('allocates a vehicle to a booking without pre-allocation', async () => {
    const { deps, calls } = await setup();
    expect(await allocate(deps, booking, 'v-1')).toMatchObject({ ok: true, warnings: [] });
    expect(calls).toEqual([allocatePath('v-1')]);
  });

  it('puts the pre-allocated vehicle back in service before allocating it', async () => {
    const { deps, calls, collection, stored } = await setup({ reasons: { 'v-1': reasonFor } });
    await createBookingState(collection, 'booking-1', { fleetId: 'FLEET-1', patch: { preallocatedVehicleId: 'v-1' } });
    expect(await allocate(deps, booking, 'v-1')).toMatchObject({ ok: true });
    expect(calls).toEqual([`POST ${fleet}/v-1/enable`, allocatePath('v-1')]);
    expect(stored()?.preallocatedVehicleId).toBeNull();
    expect((stored()?.events as { type: string }[]).at(-1)?.type).toBe('allocated');
  });

  it('frees the pre-allocated vehicle after allocating another', async () => {
    const { deps, calls, collection } = await setup({ reasons: { 'v-1': reasonFor } });
    await createBookingState(collection, 'booking-1', { fleetId: 'FLEET-1', patch: { preallocatedVehicleId: 'v-1' } });
    await allocate(deps, booking, 'v-2');
    expect(calls).toEqual([allocatePath('v-2'), `POST ${fleet}/v-1/enable`]);
  });

  it('puts the pre-allocated vehicle out of service again when the allocation fails', async () => {
    const { deps, calls, collection } = await setup({
      reasons: { 'v-1': reasonFor },
      fail: (call) => (call.includes('/allocate/') ? 400 : undefined),
    });
    await createBookingState(collection, 'booking-1', { fleetId: 'FLEET-1', patch: { preallocatedVehicleId: 'v-1' } });
    expect(await allocate(deps, booking, 'v-1')).toEqual({ ok: false, failure: { kind: 'api', error: { kind: 'http', status: 400 } } });
    expect(calls).toEqual([`POST ${fleet}/v-1/enable`, allocatePath('v-1'), `POST ${fleet}/v-1/disable`]);
  });

  it('says when the vehicle cannot be put out of service again', async () => {
    const { deps, collection } = await setup({
      reasons: { 'v-1': reasonFor },
      fail: (call) => (call.includes('/allocate/') ? 400 : call.endsWith('/disable') ? 500 : undefined),
    });
    await createBookingState(collection, 'booking-1', { fleetId: 'FLEET-1', patch: { preallocatedVehicleId: 'v-1' } });
    expect(await allocate(deps, booking, 'v-1')).toMatchObject({ ok: false, failure: { kind: 'rollback-failed', vehicleId: 'v-1' } });
  });

  it('fails when the pre-allocated vehicle cannot be put back in service', async () => {
    const { deps, calls, collection } = await setup({
      reasons: { 'v-1': reasonFor },
      fail: (call) => (call.endsWith('/enable') ? 500 : undefined),
    });
    await createBookingState(collection, 'booking-1', { fleetId: 'FLEET-1', patch: { preallocatedVehicleId: 'v-1' } });
    expect((await allocate(deps, booking, 'v-1')).ok).toBe(false);
    expect(calls).toEqual([`POST ${fleet}/v-1/enable`]);
  });
});

describe('cancel', () => {
  it('cancels, then frees the pre-allocated vehicle', async () => {
    const { deps, calls, collection, stored } = await setup({ reasons: { 'v-1': reasonFor } });
    await createBookingState(collection, 'booking-1', { fleetId: 'FLEET-1', patch: { preallocatedVehicleId: 'v-1' } });
    expect(await cancel(deps, 'booking-1')).toMatchObject({ ok: true, warnings: [] });
    expect(calls).toEqual([
      'POST user/scheduleATrip/fleets/FLEET-1/bookingrequests/cancel/booking-1',
      `POST ${fleet}/v-1/enable`,
    ]);
    expect(stored()?.preallocatedVehicleId).toBeNull();
  });

  it('changes nothing when the cancellation is refused', async () => {
    const { deps, calls } = await setup({ fail: () => 403 });
    expect(await cancel(deps, 'booking-1')).toEqual({ ok: false, failure: { kind: 'api', error: { kind: 'not-allowed', status: 403 } } });
    expect(calls).toHaveLength(1);
  });

  it('warns when the state cannot be read after the cancellation', async () => {
    const { deps, bo } = await setup();
    bo.storage.api.get.mockRejectedValueOnce(hostError('rate-limited', 429));
    expect(await cancel(deps, 'booking-1')).toMatchObject({
      ok: true,
      warnings: [{ kind: 'state-not-updated', error: { kind: 'rate-limited' } }],
    });
  });
});
