import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../test/fake-bo';
import {
  chargeProduct,
  getInvoice,
  getRefundableAmount,
  listBilledInvoices,
  listEntityWallets,
  listInvoicesByIds,
  MAX_INVOICE_IDS,
  readChargedInvoice,
  refundInvoice,
  retryPayment,
  setWalletAvailableAmount,
} from './billing';

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
        refundInProgress: false,
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

describe('readChargedInvoice', () => {
  it('reads a bare id, a JSON string or an invoice object', () => {
    expect(readChargedInvoice('invoice-1')).toEqual({ invoiceId: 'invoice-1', status: null });
    expect(readChargedInvoice('"invoice-1"')).toEqual({ invoiceId: 'invoice-1', status: null });
    expect(readChargedInvoice('{"id":"invoice-1","invoicesStatus":"PAID"}')).toEqual({ invoiceId: 'invoice-1', status: 'PAID' });
    expect(readChargedInvoice('{"id":"invoice-1","billingStatus":"PENDING"}')).toEqual({ invoiceId: 'invoice-1', status: 'PENDING' });
  });

  it('gives a null id for an answer it cannot read', () => {
    expect(readChargedInvoice('')).toEqual({ invoiceId: null, status: null });
    expect(readChargedInvoice('not an id')).toEqual({ invoiceId: null, status: null });
    expect(readChargedInvoice('{"other":1}')).toEqual({ invoiceId: null, status: null });
    expect(readChargedInvoice('[1]')).toEqual({ invoiceId: null, status: null });
    expect(readChargedInvoice('"a b"')).toEqual({ invoiceId: null, status: null });
    expect(readChargedInvoice('Created')).toEqual({ invoiceId: null, status: null });
    expect(readChargedInvoice('"OK"')).toEqual({ invoiceId: null, status: null });
  });
});

describe('chargeProduct', () => {
  const input = {
    productId: 'product-1',
    amount: 12.5,
    userId: 'user-1',
    entityId: 'entity-1',
    originId: 'operator-1',
    productNotes: 'Schedule a trip b-1 – 3 h',
  };

  it('posts the product and reads the id of the invoice', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('"invoice-1"', { status: 201 }));

    const result = await chargeProduct(authFetch, 'FLEET-1', { ...input, bookingRequestId: 'b-1' });

    expect(result).toEqual({ ok: true, data: { invoiceId: 'invoice-1', status: null } });
    const [path, init] = authFetch.mock.calls[0] ?? [];
    expect(path).toBe('user/billing/fleets/FLEET-1/invoices/product');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ ...input, additionalInfo: { bookingRequestId: 'b-1' } });
  });

  it.each([0, -1, Number.NaN])('refuses the amount %s without calling', async (amount) => {
    const authFetch = vi.fn<AuthFetch>();
    expect(await chargeProduct(authFetch, 'FLEET-1', { ...input, amount })).toMatchObject({ ok: false, error: { kind: 'invalid-request' } });
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('sends no additionalInfo without a booking', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('', { status: 201 }));
    const result = await chargeProduct(authFetch, 'FLEET-1', input);
    expect(result).toEqual({ ok: true, data: { invoiceId: null, status: null } });
    expect(JSON.parse(String(authFetch.mock.calls[0]?.[1]?.body))).toEqual(input);
  });

  it('gives the failure of the API', async () => {
    const refused = vi.fn<AuthFetch>(async () => new Response('{}', { status: 400 }));
    expect(await chargeProduct(refused, 'FLEET-1', input)).toEqual({ ok: false, error: { kind: 'http', status: 400 } });
    const lost = vi.fn<AuthFetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await chargeProduct(lost, 'FLEET-1', input)).toMatchObject({ ok: false, error: { kind: 'network' } });
  });
});

describe('retryPayment', () => {
  it('posts the retry and ignores the body', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('', { status: 200 }));
    expect(await retryPayment(authFetch, 'FLEET-1', 'invoice-1')).toEqual({ ok: true, data: { status: 200 } });
    expect(authFetch.mock.calls[0]?.[0]).toBe('user/billing/fleets/FLEET-1/invoices/invoice-1/retry-payment');
    expect(authFetch.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('maps a 403', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('{}', { status: 403 }));
    expect(await retryPayment(authFetch, 'FLEET-1', 'invoice-1')).toEqual({ ok: false, error: { kind: 'not-allowed', status: 403 } });
  });
});

describe('getRefundableAmount', () => {
  it('reads the amount and the psp references of the receipts', async () => {
    const authFetch = vi.fn<AuthFetch>(async () =>
      jsonResponse({ invoiceId: 'i', fleetId: 'F', refundableAmount: 20, currency: 'EUR', refundablePaymentReceipts: [{ pspReference: 'psp-1' }, { pspReference: null }] }),
    );
    expect(await getRefundableAmount(authFetch, 'FLEET-1', 'invoice-1')).toEqual({
      ok: true,
      data: { amount: 20, currency: 'EUR', pspReferences: ['psp-1'] },
    });
    expect(authFetch.mock.calls[0]?.[0]).toBe('user/billing/fleets/FLEET-1/invoices/invoice-1/refundableAmount');
  });

  it('reads no receipts as an empty list', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse({ refundableAmount: 0 }));
    expect(await getRefundableAmount(authFetch, 'FLEET-1', 'i')).toEqual({ ok: true, data: { amount: 0, currency: null, pspReferences: [] } });
  });

  it('refuses an answer without an amount', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse({}));
    expect(await getRefundableAmount(authFetch, 'FLEET-1', 'i')).toMatchObject({ ok: false, error: { kind: 'invalid-response' } });
  });
});

describe('refundInvoice', () => {
  it('posts the amount, the note and the receipt', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('"ok"', { status: 200 }));
    const result = await refundInvoice(authFetch, 'FLEET-1', 'invoice-1', { amount: 20, note: 'n', paymentIntentPspReference: 'psp-1' });
    expect(result.ok).toBe(true);
    expect(authFetch.mock.calls[0]?.[0]).toBe('user/billing/fleets/FLEET-1/invoices/invoice-1/refund');
    expect(JSON.parse(String(authFetch.mock.calls[0]?.[1]?.body))).toEqual({ amount: 20, note: 'n', paymentIntentPspReference: 'psp-1' });
  });

  it('refuses an amount that is not positive without calling', async () => {
    const authFetch = vi.fn<AuthFetch>();
    expect(await refundInvoice(authFetch, 'FLEET-1', 'invoice-1', { amount: 0, note: 'n', paymentIntentPspReference: null })).toMatchObject({ ok: false, error: { kind: 'invalid-request' } });
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('leaves the receipt out when there is none, and gives a failure', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('{}', { status: 400 }));
    const result = await refundInvoice(authFetch, 'FLEET-1', 'invoice-1', { amount: 20, note: 'n', paymentIntentPspReference: null });
    expect(result).toEqual({ ok: false, error: { kind: 'http', status: 400 } });
    expect(JSON.parse(String(authFetch.mock.calls[0]?.[1]?.body))).toEqual({ amount: 20, note: 'n' });
  });
});

describe('listEntityWallets', () => {
  it('reads the id and the balance of each wallet', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse([{ id: 'w-1', availableAmount: 4.5, entityId: 'e' }, { id: 'w-2' }]));
    expect(await listEntityWallets(authFetch, 'FLEET-1', 'entity-1')).toEqual({
      ok: true,
      data: [{ id: 'w-1', availableAmount: 4.5 }, { id: 'w-2', availableAmount: null }],
    });
    expect(authFetch.mock.calls[0]?.[0]).toBe('user/billing/fleets/FLEET-1/wallet/entity/entity-1');
  });

  it('gives a failure', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('{}', { status: 404 }));
    expect(await listEntityWallets(authFetch, 'FLEET-1', 'e')).toEqual({ ok: false, error: { kind: 'not-found', status: 404 } });
  });
});

describe('setWalletAvailableAmount', () => {
  it('patches the available amount with a JSON Patch', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse({ id: 'w-1' }));
    expect((await setWalletAvailableAmount(authFetch, 'FLEET-1', 'w-1', 0)).ok).toBe(true);
    const [path, init] = authFetch.mock.calls[0] ?? [];
    expect(path).toBe('user/billing/fleets/FLEET-1/wallets/w-1');
    expect(init?.method).toBe('PATCH');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json-patch+json' });
    expect(JSON.parse(String(init?.body))).toEqual([{ op: 'replace', path: '/availableAmount', value: '0' }]);
  });

  it('refuses a negative amount without calling', async () => {
    const authFetch = vi.fn<AuthFetch>();
    expect(await setWalletAvailableAmount(authFetch, 'FLEET-1', 'w-1', -1)).toMatchObject({ ok: false, error: { kind: 'invalid-request' } });
    expect(authFetch).not.toHaveBeenCalled();
  });
});

describe('listBilledInvoices', () => {
  const params = { startDate: '2026-03-10T07:50:00.000Z', endDate: '2026-03-10T08:10:00.000Z', minAmount: 50, maxAmount: 50, page: 0, size: 100 };

  it('lists the invoices of a range, reduced to what identifies them', async () => {
    const authFetch = vi.fn<AuthFetch>(async () =>
      jsonResponse([
        {
          totalWithTax: 60,
          invoice: { id: 'i-1', invoicesStatus: 'PAID', userId: 'u', entityId: 'e', billingDate: '2026-03-10T08:00:00Z', firstName: 'dropped' },
          product: { productId: 'p', productNotes: 'n', totalWithTax: 50 },
        },
        { invoice: { id: 'i-2' } },
      ]),
    );
    expect(await listBilledInvoices(authFetch, 'FLEET-1', params)).toEqual({
      ok: true,
      data: [
        { id: 'i-1', status: 'PAID', userId: 'u', entityId: 'e', productId: 'p', productNotes: 'n', amount: 50, billingDate: '2026-03-10T08:00:00Z' },
        { id: 'i-2', status: null, userId: null, entityId: null, productId: null, productNotes: null, amount: null, billingDate: null },
      ],
    });
    const query = new URLSearchParams(String(authFetch.mock.calls[0]?.[0]).split('?')[1]);
    expect(Object.fromEntries(query)).toEqual({ startDate: params.startDate, endDate: params.endDate, page: '0', size: '100', minAmount: '50', maxAmount: '50' });
  });

  it.each([
    ['an end before the start', { endDate: '2026-03-10T07:00:00.000Z' }],
    ['a range too long', { endDate: '2026-05-10T07:00:00.000Z' }],
    ['an invalid date', { startDate: 'nope' }],
    ['a negative page', { page: -1 }],
    ['a page too large', { size: 1000 }],
  ])('refuses %s without calling', async (_, override) => {
    const authFetch = vi.fn<AuthFetch>();
    expect(await listBilledInvoices(authFetch, 'FLEET-1', { ...params, ...override })).toMatchObject({ ok: false, error: { kind: 'invalid-request' } });
    expect(authFetch).not.toHaveBeenCalled();
  });
});

describe('listInvoicesByIds', () => {
  const entity = (id: string, invoicesStatus: string) => ({
    id,
    invoicesStatus,
    amount: 11,
    currency: 'EUR',
    userId: 'user-9',
    entityId: 'entity-1',
    productId: 'product-1',
    invoiceDate: '2026-11-17T12:45:00.000Z',
    pspReference: 'dropped',
  });

  it('posts the ids and gives the result of each invoice by id, whatever their order', async () => {
    const authFetch = vi.fn<AuthFetch>(async () =>
      jsonResponse([entity('invoice-2', 'PENDING'), entity('invoice-1', 'PAID')]),
    );

    const result = await listInvoicesByIds(authFetch, 'FLEET 1', ['invoice-1', 'invoice-2']);

    expect(authFetch).toHaveBeenCalledWith('user/billing/fleets/FLEET%201/invoices/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(['invoice-1', 'invoice-2']),
      signal: undefined,
    });
    expect(result.ok && result.data.get('invoice-1')).toEqual({
      ok: true,
      data: {
        id: 'invoice-1',
        status: 'PAID',
        amount: 11,
        currency: 'EUR',
        userId: 'user-9',
        entityId: 'entity-1',
        productId: 'product-1',
        invoiceDate: '2026-11-17T12:45:00.000Z',
        refundInProgress: false,
      },
    });
    expect(result.ok && result.data.get('invoice-2')).toMatchObject({ ok: true, data: { status: 'PENDING' } });
  });

  it('leaves out the ids the API does not answer', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse([entity('invoice-1', 'PAID')]));

    const result = await listInvoicesByIds(authFetch, 'FLEET-1', ['invoice-1', 'unknown']);

    expect(result.ok && [...result.data.keys()]).toEqual(['invoice-1']);
  });

  it('fails the id of an invoice it cannot read only', async () => {
    const authFetch = vi.fn<AuthFetch>(async () =>
      jsonResponse([entity('invoice-1', 'PAID'), { id: 'invoice-2', amount: null }]),
    );

    const result = await listInvoicesByIds(authFetch, 'FLEET-1', ['invoice-1', 'invoice-2']);

    expect(result.ok && result.data.get('invoice-1')?.ok).toBe(true);
    expect(result.ok && result.data.get('invoice-2')).toMatchObject({
      ok: false,
      error: { kind: 'invalid-response' },
    });
  });

  it.each([
    ['an invoice not asked for', [{ id: 'other', invoicesStatus: 'PAID', amount: 1 }]],
    ['an invoice without an id', [{ invoicesStatus: 'PAID', amount: 1 }]],
    ['an answer that is not a list', { content: [] }],
  ])('gives invalid-response for %s: the contract of the route is broken', async (_, body) => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse(body));
    expect(await listInvoicesByIds(authFetch, 'FLEET-1', ['invoice-1'])).toMatchObject({
      ok: false,
      error: { kind: 'invalid-response' },
    });
  });

  it('sends each id once', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse([]));
    await listInvoicesByIds(authFetch, 'FLEET-1', ['a', 'b', 'a']);
    expect(authFetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(['a', 'b']));
  });

  it('gives an empty map without a call for no id', async () => {
    const authFetch = vi.fn<AuthFetch>();
    const result = await listInvoicesByIds(authFetch, 'FLEET-1', []);
    expect(result.ok && result.data.size).toBe(0);
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('counts the distinct ids against MAX_INVOICE_IDS, and refuses more without a call', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse([]));
    const ids = Array.from({ length: MAX_INVOICE_IDS + 1 }, (_, index) => `invoice-${index}`);

    expect((await listInvoicesByIds(authFetch, 'FLEET-1', [...ids.slice(1), ids[1] ?? ''])).ok).toBe(true);
    authFetch.mockClear();
    const result = await listInvoicesByIds(authFetch, 'FLEET-1', ids);

    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-request' } });
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('gives not-allowed for a 403 (an environment without the route)', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('{}', { status: 403 }));
    expect(await listInvoicesByIds(authFetch, 'FLEET-1', ['a'])).toEqual({
      ok: false,
      error: { kind: 'not-allowed', status: 403 },
    });
  });

  it('gives aborted when the caller aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const authFetch = vi.fn<AuthFetch>(async () => {
      throw new DOMException('Aborted', 'AbortError');
    });
    expect(await listInvoicesByIds(authFetch, 'FLEET-1', ['a'], controller.signal)).toEqual({
      ok: false,
      error: { kind: 'aborted' },
    });
  });
});
