import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../test/fake-bo';
import {
  disableVehicle,
  enableVehicle,
  listLiveVehicles,
  listModels,
  listTripsInProgress,
  listVehicleCatalog,
  VEHICLE_PAGE_SIZE,
  vehicleStatusOf,
} from './vehicles';

describe('listModels', () => {
  it('reads the models of the fleet', async () => {
    const authFetch = vi.fn<AuthFetch>(async () =>
      jsonResponse([
        {
          id: 7,
          name: 'City car',
          brand: 'Example',
          status: 'ACTIVE',
          vehicleType: 'CAR',
          nbOfSeats: 4,
        },
        { id: 8, name: 'Van' },
      ]),
    );

    const result = await listModels(authFetch, 'FLEET-1');

    expect(authFetch).toHaveBeenCalledWith('user/vehicle/fleets/FLEET-1/vehicles/models', {
      signal: undefined,
    });
    expect(result).toEqual({
      ok: true,
      data: [
        { id: 7, name: 'City car', brand: 'Example', status: 'ACTIVE', vehicleType: 'CAR' },
        { id: 8, name: 'Van', brand: null, status: null, vehicleType: null },
      ],
    });
  });

  it('maps a 403 to not-allowed', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('', { status: 403 }));
    expect(await listModels(authFetch, 'FLEET-1')).toEqual({
      ok: false,
      error: { kind: 'not-allowed', status: 403 },
    });
  });

  it('reports a model without a numeric id', async () => {
    const authFetch = vi.fn<AuthFetch>(async () =>
      jsonResponse([{ id: 'seven', name: 'City car' }]),
    );
    const result = await listModels(authFetch, 'FLEET-1');
    expect(result.ok === false && result.error.kind).toBe('invalid-response');
  });
});

const fullPage = <T>(row: (index: number) => T) =>
  Array.from({ length: VEHICLE_PAGE_SIZE }, (_, index) => row(index));

describe('listVehicleCatalog', () => {
  it('reads every page and keeps name, plate, model and services', async () => {
    const authFetch = vi.fn<AuthFetch>(async (path) =>
      String(path).includes('page=0')
        ? jsonResponse(fullPage((index) => ({ id: `v-${index}`, name: 'n', plate: 'p' })))
        : jsonResponse([
            {
              id: 'vehicle-1',
              name: 'Car 1',
              plate: 'AB-123-CD',
              vin: 'secret-ish',
              model: { id: 7, name: 'City car' },
              serviceIds: ['service-1'],
            },
          ]),
    );

    const result = await listVehicleCatalog(authFetch, 'FLEET-1');

    expect(authFetch).toHaveBeenNthCalledWith(
      2,
      `user/vehicle/fleets/FLEET-1/vehicles?page=1&size=${VEHICLE_PAGE_SIZE}`,
      { signal: undefined },
    );
    expect(result.ok && result.data.length).toBe(VEHICLE_PAGE_SIZE + 1);
    expect(result.ok && result.data.at(-1)).toEqual({
      id: 'vehicle-1',
      name: 'Car 1',
      plate: 'AB-123-CD',
      modelId: 7,
      modelName: 'City car',
      serviceIds: ['service-1'],
    });
    expect(result.ok && result.data[0]).toMatchObject({ modelId: null, serviceIds: [] });
  });

  it('fails as a whole when a page fails', async () => {
    const authFetch = vi.fn<AuthFetch>(async (path) =>
      String(path).includes('page=0')
        ? jsonResponse(fullPage((index) => ({ id: `v-${index}` })))
        : new Response('', { status: 500 }),
    );
    expect(await listVehicleCatalog(authFetch, 'FLEET-1')).toEqual({
      ok: false,
      error: { kind: 'http', status: 500 },
    });
  });

  it('stops after a bounded number of full pages', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse(fullPage((i) => ({ id: `v-${i}` }))));
    const result = await listVehicleCatalog(authFetch, 'FLEET-1');
    expect(result.ok ? null : result.error.kind).toBe('invalid-response');
    expect(authFetch).toHaveBeenCalledTimes(50);
  });
});

describe('vehicleStatusOf', () => {
  it.each([
    [0, 'AVAILABLE'],
    [1, 'IN_USE'],
    [2, 'OUT_OF_SERVICE'],
    [3, 'ARCHIVED'],
    [4, 'UNKNOWN'],
    [null, 'UNKNOWN'],
  ] as const)('maps %s to %s', (code, status) => {
    expect(vehicleStatusOf(code)).toBe(status);
  });
});

describe('listLiveVehicles', () => {
  it('maps the status, the position and the energy', async () => {
    const authFetch = vi.fn<AuthFetch>(async () =>
      jsonResponse([
        {
          id: 'vehicle-1',
          plate: 'AB-123-CD',
          vehicle_status: 0,
          location: { latitude: 48.85, longitude: 2.35 },
          autonomy: 120,
          energyLevel: 80,
          km: 1200,
          userId: 'never-kept',
        },
        { id: 'vehicle-2', vehicle_status: 2, outOfServiceReason: 'Repair', location: {} },
        { id: 'vehicle-3', orderId: 'trip-1' },
      ]),
    );

    const result = await listLiveVehicles(authFetch, 'FLEET-1');

    expect(authFetch).toHaveBeenCalledWith(
      `fleetmanager/public/fleets/FLEET-1/vehicles?page=0&size=${VEHICLE_PAGE_SIZE}`,
      { signal: undefined },
    );
    expect(result).toEqual({
      ok: true,
      data: [
        {
          id: 'vehicle-1',
          plate: 'AB-123-CD',
          status: 'AVAILABLE',
          location: { latitude: 48.85, longitude: 2.35 },
          autonomy: 120,
          energyLevel: 80,
          km: 1200,
          outOfServiceReason: null,
          tripId: null,
        },
        {
          id: 'vehicle-2',
          plate: null,
          status: 'OUT_OF_SERVICE',
          location: null,
          autonomy: null,
          energyLevel: null,
          km: null,
          outOfServiceReason: 'Repair',
          tripId: null,
        },
        {
          id: 'vehicle-3',
          plate: null,
          status: 'UNKNOWN',
          location: null,
          autonomy: null,
          energyLevel: null,
          km: null,
          outOfServiceReason: null,
          tripId: 'trip-1',
        },
      ],
    });
  });

  it('reports an unreadable answer', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse({ not: 'a list' }));
    const result = await listLiveVehicles(authFetch, 'FLEET-1');
    expect(result.ok ? null : result.error.kind).toBe('invalid-response');
  });
});

describe('listTripsInProgress', () => {
  it('keeps the vehicles with a trip', async () => {
    const authFetch = vi.fn<AuthFetch>(async () =>
      jsonResponse([
        { id: 'vehicle-1', plate: 'AB-123-CD', orderId: 'trip-1' },
        { id: 'vehicle-2', orderId: null },
      ]),
    );
    expect(await listTripsInProgress(authFetch, 'FLEET-1')).toEqual({
      ok: true,
      data: [{ tripId: 'trip-1', vehicleId: 'vehicle-1', plate: 'AB-123-CD' }],
    });
    expect(authFetch).toHaveBeenCalledWith('fleetmanager/public/fleets/FLEET-1/book', {
      signal: undefined,
    });
  });

  it('reads a 404 as no trip in progress', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('', { status: 404 }));
    expect(await listTripsInProgress(authFetch, 'FLEET-1')).toEqual({ ok: true, data: [] });
  });

  it('keeps any other failure', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('', { status: 503 }));
    expect(await listTripsInProgress(authFetch, 'FLEET-1')).toEqual({
      ok: false,
      error: { kind: 'http', status: 503 },
    });
  });
});

describe('disableVehicle and enableVehicle', () => {
  it('put a vehicle out of service with a reason, and back', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response(null, { status: 200 }));
    expect(await disableVehicle(authFetch, 'FLEET-1', 'vehicle-1', 'Reason')).toEqual({ ok: true, data: null });
    expect(await enableVehicle(authFetch, 'FLEET-1', 'vehicle-1')).toEqual({ ok: true, data: null });
    const [disablePath, disableInit] = authFetch.mock.calls[0] ?? [];
    expect(disablePath).toBe('fleetmanager/public/fleets/FLEET-1/vehicles/vehicle-1/disable');
    expect(disableInit).toMatchObject({ method: 'POST', body: '{"subStatus":"Reason"}' });
    expect(authFetch.mock.calls[1]?.[0]).toBe('fleetmanager/public/fleets/FLEET-1/vehicles/vehicle-1/enable');
  });

  it('report a refusal', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('', { status: 404 }));
    const result = await disableVehicle(authFetch, 'FLEET-1', 'vehicle-1', 'Reason');
    expect(result.ok ? null : result.error.kind).toBe('not-found');
  });
});
