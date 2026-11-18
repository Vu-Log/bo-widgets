import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../test/fake-bo';
import { getProductPrice } from './products';

describe('getProductPrice', () => {
  it('reads the price of a product', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse({ id: 'p-1', price: 15, name: 'Fees', taxRate: 20 }));
    expect(await getProductPrice(authFetch, 'FLEET-1', 'p-1')).toEqual({ ok: true, data: { id: 'p-1', price: 15 } });
    expect(authFetch).toHaveBeenCalledWith('user/fleets/FLEET-1/products/p-1', { signal: undefined });
  });

  it('gives a 403 as not-allowed', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('{}', { status: 403 }));
    expect(await getProductPrice(authFetch, 'FLEET-1', 'p-1')).toEqual({ ok: false, error: { kind: 'not-allowed', status: 403 } });
  });

  it('refuses a product without a price', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse({ id: 'p-1' }));
    expect(await getProductPrice(authFetch, 'FLEET-1', 'p-1')).toMatchObject({ ok: false, error: { kind: 'invalid-response' } });
  });
});
