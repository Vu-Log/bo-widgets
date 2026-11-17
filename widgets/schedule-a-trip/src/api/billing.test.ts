import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../test/fake-bo';
import { getInvoice } from './billing';

describe('getInvoice', () => {
  it('reads the status and amount of an invoice', async () => {
    const authFetch = vi.fn<AuthFetch>(async () =>
      jsonResponse({
        id: 'invoice-1',
        invoicesStatus: 'PAID',
        amount: 20.83,
        currency: 'EUR',
        userId: 'user-9',
        entityId: 'entity-1',
        productId: '11111111-1111-4111-8111-111111111111',
        invoiceDate: '2026-03-01T10:00:00Z',
        pspReference: 'dropped',
      }),
    );

    const result = await getInvoice(authFetch, 'FLEET-1', 'invoice-1');

    expect(authFetch).toHaveBeenCalledWith('user/billing/fleets/FLEET-1/invoices/invoice-1', {
      signal: undefined,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        id: 'invoice-1',
        status: 'PAID',
        amount: 20.83,
        currency: 'EUR',
        userId: 'user-9',
        entityId: 'entity-1',
        productId: '11111111-1111-4111-8111-111111111111',
        invoiceDate: '2026-03-01T10:00:00Z',
      },
    });
  });

  it('gives not-found for an unknown invoice', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('{}', { status: 404 }));
    expect(await getInvoice(authFetch, 'FLEET-1', 'nope')).toEqual({
      ok: false,
      error: { kind: 'not-found', status: 404 },
    });
  });

  it('maps a 403 to not-allowed', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('', { status: 403 }));
    expect(await getInvoice(authFetch, 'FLEET-1', 'invoice-1')).toEqual({
      ok: false,
      error: { kind: 'not-allowed', status: 403 },
    });
  });

  it('reports an invoice without a status', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse({ id: 'invoice-1', amount: 1 }));
    const result = await getInvoice(authFetch, 'FLEET-1', 'invoice-1');
    expect(result.ok === false && result.error.kind).toBe('invalid-response');
  });

  it('encodes the invoice id in the path', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('', { status: 404 }));
    await getInvoice(authFetch, 'FLEET-1', '../users');
    expect(authFetch.mock.calls[0]?.[0]).toBe('user/billing/fleets/FLEET-1/invoices/..%2Fusers');
  });
});
