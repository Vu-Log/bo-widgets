// Test helper: a fake of the billing routes of the Vulog API the prepayment feature calls, with an
// in-memory state (invoices, refundable amounts, products, wallets) and a log of the calls.
import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { vi } from 'vitest';
import { API_BASE_URL, jsonResponse } from './fake-bo';

/** An invoice of the fake API. */
export interface FakeInvoice {
  id: string;
  status: string;
  amount: number;
  userId: string;
  entityId: string;
  productId: string;
  productNotes: string;
  billingDate: string;
  refundable: number;
}

/** A call the fake answered. */
export interface FakeCall {
  method: string;
  path: string;
  body: unknown;
}

/** A failure to answer a route with: an HTTP status, or a rejection (lost answer). */
export type FakeFailure = { status: number } | { reject: Error };

/** The routes a test can make fail, by a short name. */
export type FakeRoute =
  | 'charge'
  | 'invoice'
  | 'retry'
  | 'refundable'
  | 'refund'
  | 'product'
  | 'wallets'
  | 'wallet-patch'
  | 'invoices-list';

/**
 * A fake of the billing routes. `failures` answers a route with an error once (or every time
 * with `always`); the state changes as the real API would (a charge creates an invoice, a refund
 * empties the refundable amount, a retry moves the invoice to PENDING, a patch sets the balance).
 */
export function fakeAima(initial: { invoices?: FakeInvoice[]; productPrice?: number; wallets?: { id: string; availableAmount: number }[] } = {}) {
  const invoices = new Map((initial.invoices ?? []).map((invoice) => [invoice.id, { ...invoice }]));
  const wallets = new Map((initial.wallets ?? []).map((wallet) => [wallet.id, { ...wallet }]));
  const calls: FakeCall[] = [];
  const failures = new Map<FakeRoute, { failure: FakeFailure; always: boolean }>();
  let productPrice = initial.productPrice ?? 15;
  let created = 0;
  /** When set, a charge creates the invoice and then answers this failure (a lost answer). */
  let loseChargeAnswer: Error | null = null;

  const fail = (route: FakeRoute): Response | null => {
    const entry = failures.get(route);
    if (!entry) return null;
    if (!entry.always) failures.delete(route);
    if ('reject' in entry.failure) throw entry.failure.reject;
    return new Response('{}', { status: entry.failure.status });
  };

  const authFetch = vi.fn<AuthFetch>(async (input, init) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, path, body });
    const [route, query] = path.split('?');
    const parts = (route ?? '').split('/');

    if (method === 'POST' && route?.endsWith('/invoices/product')) {
      const failed = fail('charge');
      if (failed) return failed;
      const input = body as Record<string, unknown>;
      created += 1;
      const invoice: FakeInvoice = {
        id: `invoice-new-${created}`,
        status: 'PENDING',
        amount: Number(input.amount),
        userId: String(input.userId),
        entityId: String(input.entityId),
        productId: String(input.productId),
        productNotes: String(input.productNotes ?? ''),
        billingDate: new Date('2026-03-10T08:00:30.000Z').toISOString(),
        refundable: 0,
      };
      invoices.set(invoice.id, invoice);
      if (loseChargeAnswer) {
        const error = loseChargeAnswer;
        loseChargeAnswer = null;
        throw error;
      }
      return new Response(JSON.stringify(invoice.id), { status: 201 });
    }
    if (method === 'POST' && route?.endsWith('/retry-payment')) {
      const failed = fail('retry');
      if (failed) return failed;
      const invoice = invoices.get(parts[5] ?? '');
      if (!invoice) return new Response('{}', { status: 404 });
      invoice.status = 'PENDING';
      return new Response('', { status: 200 });
    }
    if (route?.endsWith('/refundableAmount')) {
      const failed = fail('refundable');
      if (failed) return failed;
      const invoice = invoices.get(parts[5] ?? '');
      if (!invoice) return new Response('{}', { status: 404 });
      return jsonResponse({
        refundableAmount: invoice.refundable,
        currency: 'EUR',
        refundablePaymentReceipts: invoice.refundable > 0 ? [{ pspReference: 'psp-1' }] : [],
      });
    }
    if (method === 'POST' && route?.endsWith('/refund')) {
      const failed = fail('refund');
      if (failed) return failed;
      const invoice = invoices.get(parts[5] ?? '');
      const amount = Number((body as { amount: number }).amount);
      if (!invoice || amount > invoice.refundable) return new Response('{}', { status: 400 });
      invoice.refundable -= amount;
      if (invoice.refundable <= 0) invoice.status = 'REFUNDED';
      return new Response('"ok"', { status: 200 });
    }
    if (parts[0] === 'user' && parts[1] === 'fleets' && parts[3] === 'products') {
      const failed = fail('product');
      if (failed) return failed;
      return jsonResponse({ id: parts[4], price: productPrice, name: 'Fees' });
    }
    if (route?.includes('/wallet/entity/')) {
      const failed = fail('wallets');
      if (failed) return failed;
      return jsonResponse([...wallets.values()]);
    }
    if (method === 'PATCH' && route?.includes('/wallets/')) {
      const failed = fail('wallet-patch');
      if (failed) return failed;
      const wallet = wallets.get(parts[5] ?? '');
      if (!wallet) return new Response('{}', { status: 404 });
      wallet.availableAmount = Number((body as [{ value: string }])[0].value);
      return new Response('', { status: 200 });
    }
    if (route?.endsWith('/invoices') && method === 'GET') {
      const failed = fail('invoices-list');
      if (failed) return failed;
      const params = new URLSearchParams(query);
      const min = Number(params.get('minAmount') ?? '-Infinity');
      const max = Number(params.get('maxAmount') ?? 'Infinity');
      const page = Number(params.get('page'));
      const size = Number(params.get('size'));
      const items = [...invoices.values()]
        .filter((invoice) => invoice.amount >= min && invoice.amount <= max)
        .slice(page * size, page * size + size)
        .map((invoice) => ({
          totalWithTax: invoice.amount,
          invoice: {
            id: invoice.id,
            invoicesStatus: invoice.status,
            userId: invoice.userId,
            entityId: invoice.entityId,
            billingDate: invoice.billingDate,
          },
          product: { productId: invoice.productId, productNotes: invoice.productNotes, totalWithTax: invoice.amount },
        }));
      return jsonResponse(items);
    }
    if (parts[2] === 'fleets' && parts[4] === 'invoices' && parts.length === 6) {
      const failed = fail('invoice');
      if (failed) return failed;
      const invoice = invoices.get(parts[5] ?? '');
      if (!invoice) return new Response('{}', { status: 404 });
      return jsonResponse({
        id: invoice.id,
        invoicesStatus: invoice.status,
        amount: invoice.amount,
        currency: 'EUR',
        userId: invoice.userId,
        entityId: invoice.entityId,
        productId: invoice.productId,
        invoiceDate: invoice.billingDate,
      });
    }
    return new Response('{}', { status: 404 });
  });

  return {
    authFetch,
    calls,
    invoices,
    wallets,
    /** Answers `route` with `failure` once, or every time with `always`. */
    failNext: (route: FakeRoute, failure: FakeFailure, always = false) =>
      failures.set(route, { failure, always }),
    /** The next charge creates its invoice, then its answer is lost with `error`. */
    loseNextChargeAnswer: (error: Error = new TypeError('Failed to fetch')) => {
      loseChargeAnswer = error;
    },
    setProductPrice: (price: number) => {
      productPrice = price;
    },
    /** Answers the `fetch` of `authFetch` (through the fake BO) with this fake. */
    stubFetch: () =>
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = new URL(String(input instanceof Request ? input.url : input));
        const path = url.pathname.replace(new URL(API_BASE_URL).pathname, '') + url.search;
        return authFetch(path, init);
      }),
    /** The calls to a route, by method and path suffix. */
    callsTo: (method: string, suffix: string) =>
      calls.filter((call) => call.method === method && call.path.split('?')[0]?.endsWith(suffix)),
  };
}

/** An invoice of the fake API with neutral values. */
export const fakeInvoice = (overrides: Partial<FakeInvoice> = {}): FakeInvoice => ({
  id: 'invoice-1',
  status: 'PAID',
  amount: 50,
  userId: 'customer-1',
  entityId: 'entity-1',
  productId: '11111111-1111-4111-8111-111111111111',
  productNotes: 'Schedule a trip booking-1 – 12 h',
  billingDate: '2026-03-10T08:00:30.000Z',
  refundable: 50,
  ...overrides,
});
