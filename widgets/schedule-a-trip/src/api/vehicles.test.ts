import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../test/fake-bo';
import { listModels } from './vehicles';

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
