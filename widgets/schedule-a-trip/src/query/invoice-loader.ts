import type { QueryClient } from '@tanstack/react-query';
import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { getInvoice, listInvoicesByIds, MAX_INVOICE_IDS, type Invoice } from '../api/billing';
import type { ApiError, ApiResult } from '../api/http';

/** Reads invoices one by one for its callers, and in batches for the API. */
export interface InvoiceLoader {
  /**
   * Reads an invoice: the ids asked for in the same task go in one call of at most
   * {@link MAX_INVOICE_IDS} ids. Never rejects for a failure of the API, only on a bug.
   *
   * @param invoiceId - The invoice.
   * @param signal - Aborts this read only: the batch goes on for the other ids.
   * @returns The invoice, `not-found` when the API left it out, or why the batch failed.
   */
  load(invoiceId: string, signal?: AbortSignal): Promise<ApiResult<Invoice>>;
}

interface Waiter {
  readonly resolve: (result: ApiResult<Invoice>) => void;
  readonly reject: (error: unknown) => void;
}

const NOT_FOUND: ApiResult<Invoice> = { ok: false, error: { kind: 'not-found', status: 404 } };
const ABORTED: ApiResult<Invoice> = { ok: false, error: { kind: 'aborted' } };

/**
 * Whether a failure of the batch route means that the environment does not have it yet: 403, 404
 * or 405. A 403 may also be a role without the right; the reads one by one then fail the same way.
 */
const isRouteMissing = (error: ApiError): boolean =>
  error.kind === 'not-allowed' ||
  error.kind === 'not-found' ||
  (error.kind === 'http' && error.status === 405);

const settle = (waiters: readonly Waiter[], result: ApiResult<Invoice>) =>
  waiters.forEach((waiter) => waiter.resolve(result));

/** Ends a read when `signal` aborts, whatever the batch it waits for. */
function abortable(
  promise: Promise<ApiResult<Invoice>>,
  signal: AbortSignal | undefined,
): Promise<ApiResult<Invoice>> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (result) => {
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Creates a loader of the invoices of a fleet. The ids asked for until the next macrotask go in one
 * `POST .../invoices/list` per {@link MAX_INVOICE_IDS} ids. When the route answers 403, 404 or 405
 * (an environment without it), that batch and every later read go through
 * `GET .../invoices/{invoiceId}`; any other failure is the answer of each id of the batch.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @returns The loader.
 */
export function createInvoiceLoader(authFetch: AuthFetch, fleetId: string): InvoiceLoader {
  let pending = new Map<string, Waiter[]>();
  let scheduled = false;
  let routeMissing = false;

  const readOneByOne = (batch: ReadonlyMap<string, Waiter[]>) => {
    for (const [invoiceId, waiters] of batch) {
      getInvoice(authFetch, fleetId, invoiceId).then(
        (result) => settle(waiters, result),
        (error: unknown) => waiters.forEach((waiter) => waiter.reject(error)),
      );
    }
  };

  const readBatch = async (batch: ReadonlyMap<string, Waiter[]>) => {
    if (routeMissing) return readOneByOne(batch);
    const result = await listInvoicesByIds(authFetch, fleetId, [...batch.keys()]);
    if (!result.ok && isRouteMissing(result.error)) {
      routeMissing = true;
      return readOneByOne(batch);
    }
    for (const [invoiceId, waiters] of batch) {
      if (!result.ok) settle(waiters, result);
      else {
        const invoice = result.data.get(invoiceId);
        settle(waiters, invoice ? { ok: true, data: invoice } : NOT_FOUND);
      }
    }
  };

  const flush = () => {
    scheduled = false;
    const entries = [...pending];
    pending = new Map();
    for (let index = 0; index < entries.length; index += MAX_INVOICE_IDS) {
      const batch = new Map(entries.slice(index, index + MAX_INVOICE_IDS));
      readBatch(batch).catch((error: unknown) => {
        for (const waiters of batch.values()) waiters.forEach((waiter) => waiter.reject(error));
      });
    }
  };

  return {
    load(invoiceId, signal) {
      const promise = new Promise<ApiResult<Invoice>>((resolve, reject) => {
        const waiters = pending.get(invoiceId) ?? [];
        waiters.push({ resolve, reject });
        pending.set(invoiceId, waiters);
        if (!scheduled) {
          scheduled = true;
          // A macrotask, not a microtask: the rows of a page mount over several renders.
          setTimeout(flush, 0);
        }
      });
      return abortable(promise, signal);
    },
  };
}

const loaders = new WeakMap<QueryClient, WeakMap<AuthFetch, Map<string, InvoiceLoader>>>();

/**
 * The loader of a fleet for a query client and an `authFetch`: created once, so that the queries of
 * a client share their batches and the knowledge that the route is missing.
 *
 * @param client - The client of the invoice queries (`client` of the `queryFn` context).
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @returns The loader.
 */
export function invoiceLoaderOf(
  client: QueryClient,
  authFetch: AuthFetch,
  fleetId: string,
): InvoiceLoader {
  let byAuthFetch = loaders.get(client);
  if (!byAuthFetch) {
    byAuthFetch = new WeakMap();
    loaders.set(client, byAuthFetch);
  }
  let byFleet = byAuthFetch.get(authFetch);
  if (!byFleet) {
    byFleet = new Map();
    byAuthFetch.set(authFetch, byFleet);
  }
  let loader = byFleet.get(fleetId);
  if (!loader) {
    loader = createInvoiceLoader(authFetch, fleetId);
    byFleet.set(fleetId, loader);
  }
  return loader;
}
