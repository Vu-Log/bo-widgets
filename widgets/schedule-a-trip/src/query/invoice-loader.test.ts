import { QueryClient } from '@tanstack/react-query';
import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../test/fake-bo';
import { fakeAima, fakeInvoice } from '../test/fake-aima';
import { createInvoiceLoader, invoiceLoaderOf } from './invoice-loader';

const ids = (count: number) => Array.from({ length: count }, (_, index) => `invoice-${index}`);
const invoices = (count: number) => ids(count).map((id) => fakeInvoice({ id }));
const gets = (aima: ReturnType<typeof fakeAima>) =>
  aima.calls.filter((call) => call.method === 'GET' && call.path.includes('/invoices/'));

describe('createInvoiceLoader', () => {
  it('reads the invoices asked for in the same task in one call, by id', async () => {
    const aima = fakeAima({
      invoices: [fakeInvoice({ id: 'a', status: 'PAID' }), fakeInvoice({ id: 'b', status: 'PENDING' })],
    });
    const loader = createInvoiceLoader(aima.authFetch, 'FLEET-1');

    const [a, b, again] = await Promise.all([loader.load('a'), loader.load('b'), loader.load('a')]);

    expect(a).toMatchObject({ ok: true, data: { id: 'a', status: 'PAID' } });
    expect(b).toMatchObject({ ok: true, data: { id: 'b', status: 'PENDING' } });
    expect(again).toEqual(a);
    expect(aima.calls).toEqual([
      { method: 'POST', path: 'user/billing/fleets/FLEET-1/invoices/list', body: ['a', 'b'] },
    ]);
  });

  it('batches the reads of several microtasks: it waits for the next macrotask', async () => {
    const aima = fakeAima({ invoices: [fakeInvoice({ id: 'a' }), fakeInvoice({ id: 'b' })] });
    const loader = createInvoiceLoader(aima.authFetch, 'FLEET-1');

    const a = loader.load('a');
    await Promise.resolve();
    await Promise.resolve();
    const b = loader.load('b');
    await Promise.all([a, b]);

    expect(aima.calls.map((call) => call.body)).toEqual([['a', 'b']]);
  });

  it('reads with a GET the ids the list leaves out: an unknown id is a not-found of the API', async () => {
    const aima = fakeAima({ invoices: [fakeInvoice({ id: 'a' })] });
    const loader = createInvoiceLoader(aima.authFetch, 'FLEET-1');

    const [a, unknown] = await Promise.all([loader.load('a'), loader.load('nope')]);

    expect(a.ok).toBe(true);
    expect(unknown).toEqual({ ok: false, error: { kind: 'not-found', status: 404 } });
    expect(aima.callsTo('GET', '/invoices/nope')).toHaveLength(1);
    expect(aima.callsTo('GET', '/invoices/a')).toHaveLength(0);
  });

  it('gives the invoice a GET finds when the list left it out (a list behind the GET)', async () => {
    const answers = [jsonResponse([]), jsonResponse({ id: 'a', invoicesStatus: 'PAID', amount: 5 })];
    const authFetch = vi.fn<AuthFetch>(async () => answers.shift() ?? new Response('', { status: 500 }));
    const loader = createInvoiceLoader(authFetch, 'FLEET-1');

    expect(await loader.load('a')).toMatchObject({ ok: true, data: { id: 'a', status: 'PAID' } });
  });

  it('fails the id of an invoice it cannot read only', async () => {
    const authFetch = vi.fn<AuthFetch>(async () =>
      jsonResponse([
        { id: 'a', invoicesStatus: 'PAID', amount: 5 },
        { id: 'b', invoicesStatus: 'PAID' },
      ]),
    );
    const loader = createInvoiceLoader(authFetch, 'FLEET-1');

    const [a, b] = await Promise.all([loader.load('a'), loader.load('b')]);

    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, error: { kind: 'invalid-response' } });
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it('reads one by one a batch whose answer breaks the contract, without giving up the list', async () => {
    const aima = fakeAima({ invoices: invoices(2) });
    const listAnswers = [jsonResponse([{ id: 'other', invoicesStatus: 'PAID', amount: 1 }])];
    const authFetch = vi.fn<AuthFetch>(async (input, init) =>
      init?.method === 'POST' && listAnswers.length > 0
        ? (listAnswers.shift() as Response)
        : aima.authFetch(input, init),
    );
    const loader = createInvoiceLoader(authFetch, 'FLEET-1');

    const first = await Promise.all([loader.load('invoice-0'), loader.load('invoice-1')]);
    const later = await loader.load('invoice-0');

    expect(first.every((result) => result.ok)).toBe(true);
    expect(gets(aima)).toHaveLength(2);
    expect(later.ok).toBe(true);
    expect(aima.callsTo('POST', '/invoices/list')).toHaveLength(1);
  });

  it('splits the ids into calls of at most 100', async () => {
    const aima = fakeAima({ invoices: invoices(150) });
    const loader = createInvoiceLoader(aima.authFetch, 'FLEET-1');

    const results = await Promise.all(ids(150).map((id) => loader.load(id)));

    expect(results.every((result) => result.ok)).toBe(true);
    expect(aima.calls.map((call) => (call.body as string[]).length)).toEqual([100, 50]);
  });

  it('fails the calls of 100 ids on their own: a 500 of one leaves the other', async () => {
    const aima = fakeAima({ invoices: invoices(150) });
    aima.failNext('invoices-by-ids', { status: 500 });
    const loader = createInvoiceLoader(aima.authFetch, 'FLEET-1');

    const results = await Promise.all(ids(150).map((id) => loader.load(id)));

    expect(results.filter((result) => !result.ok)).toHaveLength(100);
    expect(results.slice(100).every((result) => result.ok)).toBe(true);
  });

  it('makes a new call for the ids asked for after a flush', async () => {
    const aima = fakeAima({ invoices: invoices(2) });
    const loader = createInvoiceLoader(aima.authFetch, 'FLEET-1');

    await loader.load('invoice-0');
    await loader.load('invoice-1');

    expect(aima.callsTo('POST', '/invoices/list')).toHaveLength(2);
  });

  it.each([403, 404, 405])(
    'reads one by one when the list answers %i, then never asks the list again',
    async (status) => {
      const aima = fakeAima({ invoices: invoices(2) });
      aima.failNext('invoices-by-ids', { status }, true);
      const loader = createInvoiceLoader(aima.authFetch, 'FLEET-1');

      const first = await Promise.all([loader.load('invoice-0'), loader.load('invoice-1')]);
      const later = await loader.load('invoice-0');

      expect(first.every((result) => result.ok)).toBe(true);
      expect(later.ok).toBe(true);
      expect(aima.callsTo('POST', '/invoices/list')).toHaveLength(1);
      expect(aima.callsTo('GET', '/invoices/invoice-0')).toHaveLength(2);
      expect(aima.callsTo('GET', '/invoices/invoice-1')).toHaveLength(1);
    },
  );

  it('reads one by one every id of the calls of 100 that met the missing route', async () => {
    const aima = fakeAima({ invoices: invoices(150) });
    aima.failNext('invoices-by-ids', { status: 403 }, true);
    const loader = createInvoiceLoader(aima.authFetch, 'FLEET-1');

    const results = await Promise.all(ids(150).map((id) => loader.load(id)));

    expect(results.every((result) => result.ok)).toBe(true);
    // Both calls leave before the first answer.
    expect(aima.callsTo('POST', '/invoices/list')).toHaveLength(2);
    expect(gets(aima)).toHaveLength(150);
  });

  it('gives the failure of a GET one by one: a role without the right stays not-allowed', async () => {
    const aima = fakeAima({ invoices: invoices(1) });
    aima.failNext('invoices-by-ids', { status: 403 });
    aima.failNext('invoice', { status: 403 });
    const loader = createInvoiceLoader(aima.authFetch, 'FLEET-1');

    expect(await loader.load('invoice-0')).toEqual({
      ok: false,
      error: { kind: 'not-allowed', status: 403 },
    });
  });

  it.each([
    ['a 500', { status: 500 }, { kind: 'http', status: 500 }],
    ['a 401', { status: 401 }, { kind: 'session-lost', status: 401 }],
    ['a lost answer', { reject: new TypeError('Failed to fetch') }, { kind: 'network' }],
  ] as const)('gives %s to every id of the batch, without reading one by one', async (_, failure, error) => {
    const aima = fakeAima({ invoices: invoices(2) });
    aima.failNext('invoices-by-ids', failure);
    const loader = createInvoiceLoader(aima.authFetch, 'FLEET-1');

    const results = await Promise.all([loader.load('invoice-0'), loader.load('invoice-1')]);

    expect(results).toEqual([
      { ok: false, error: expect.objectContaining(error) },
      { ok: false, error: expect.objectContaining(error) },
    ]);
    expect(gets(aima)).toHaveLength(0);
    // Not remembered as missing: the next read asks the list again.
    expect((await loader.load('invoice-0')).ok).toBe(true);
    expect(aima.callsTo('POST', '/invoices/list')).toHaveLength(2);
  });

  it('ends an aborted read only: the batch goes on for the other ids', async () => {
    const aima = fakeAima({ invoices: invoices(2) });
    const loader = createInvoiceLoader(aima.authFetch, 'FLEET-1');
    const controller = new AbortController();

    const aborted = loader.load('invoice-0', controller.signal);
    const other = loader.load('invoice-1');
    controller.abort();

    expect(await aborted).toEqual({ ok: false, error: { kind: 'aborted' } });
    expect((await other).ok).toBe(true);
    const [call] = aima.callsTo('POST', '/invoices/list');
    expect(call?.body).toEqual(['invoice-0', 'invoice-1']);
  });

  it('gives its own answer to each read of the same id: one aborted, one not', async () => {
    const aima = fakeAima({ invoices: invoices(1) });
    const loader = createInvoiceLoader(aima.authFetch, 'FLEET-1');
    const controller = new AbortController();

    const aborted = loader.load('invoice-0', controller.signal);
    const kept = loader.load('invoice-0');
    controller.abort();

    expect(await aborted).toEqual({ ok: false, error: { kind: 'aborted' } });
    expect(await kept).toMatchObject({ ok: true, data: { id: 'invoice-0' } });
    expect(aima.calls.map((call) => call.body)).toEqual([['invoice-0']]);
  });

  it('gives aborted at once for a signal already aborted', async () => {
    const aima = fakeAima({ invoices: invoices(1) });
    const loader = createInvoiceLoader(aima.authFetch, 'FLEET-1');

    expect(await loader.load('invoice-0', AbortSignal.abort())).toEqual({
      ok: false,
      error: { kind: 'aborted' },
    });
  });

  it('rejects every read of the batch on a bug of authFetch', async () => {
    const bug = new RangeError('bug');
    const authFetch = vi.fn<AuthFetch>(async () => {
      throw bug;
    });
    const loader = createInvoiceLoader(authFetch, 'FLEET-1');

    await expect(Promise.all([loader.load('a'), loader.load('b')])).rejects.toBe(bug);
  });

  it('rejects the read of a GET one by one on a bug of authFetch', async () => {
    const bug = new RangeError('bug');
    const authFetch = vi.fn<AuthFetch>(async (_, init) => {
      if (init?.method === 'POST') return new Response('{}', { status: 403 });
      throw bug;
    });
    const loader = createInvoiceLoader(authFetch, 'FLEET-1');

    await expect(loader.load('a')).rejects.toBe(bug);
  });
});

describe('invoiceLoaderOf', () => {
  it('gives one loader per client, authFetch and fleet', () => {
    const client = new QueryClient();
    const authFetch = vi.fn<AuthFetch>();

    const loader = invoiceLoaderOf(client, authFetch, 'FLEET-1');

    expect(invoiceLoaderOf(client, authFetch, 'FLEET-1')).toBe(loader);
    expect(invoiceLoaderOf(client, authFetch, 'FLEET-2')).not.toBe(loader);
    expect(invoiceLoaderOf(client, vi.fn<AuthFetch>(), 'FLEET-1')).not.toBe(loader);
    expect(invoiceLoaderOf(new QueryClient(), authFetch, 'FLEET-1')).not.toBe(loader);
  });
});
