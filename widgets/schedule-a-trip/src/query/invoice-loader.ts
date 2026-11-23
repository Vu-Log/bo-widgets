import type { QueryClient } from '@tanstack/react-query';
import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { getInvoice, listInvoicesByIds, MAX_INVOICE_IDS, type Invoice } from '../api/billing';
import type { ApiError, ApiResult } from '../api/http';

/** Reads invoices one by one for its callers, and in batches for the API. */
export interface InvoiceLoader {
  /**
   * Reads an invoice: the ids asked for until the next macrotask go in one call of at most
   * {@link MAX_INVOICE_IDS} ids. Never rejects for a failure of the API, only on a bug.
   *
   * @param invoiceId - The invoice.
   * @param signal - Ends this read only: the batch goes on for the other ids, and its request is
   *   never aborted.
   * @returns The invoice, or why the read failed: `aborted` when `signal` aborts, the failure of
   *   the batch, or the failure of the GET by id when the invoice was read one by one.
   */
  load(invoiceId: string, signal?: AbortSignal): Promise<ApiResult<Invoice>>;
}

interface Waiter {
  readonly resolve: (result: ApiResult<Invoice>) => void;
  readonly reject: (error: unknown) => void;
}

type Batch = ReadonlyMap<string, readonly Waiter[]>;

const ABORTED: ApiResult<Invoice> = { ok: false, error: { kind: 'aborted' } };

/**
 * Whether a failure of the batch route means that the environment does not have it: 403, 404 or
 * 405. A 403 may also be a role without the right; the reads one by one then fail the same way.
 */
const isRouteMissing = (error: ApiError): boolean =>
  error.kind === 'not-allowed' ||
  error.kind === 'not-found' ||
  (error.kind === 'http' && error.status === 405);

const settle = (waiters: readonly Waiter[], result: ApiResult<Invoice>) =>
  waiters.forEach((waiter) => waiter.resolve(result));

const rejectAll = (waiters: readonly Waiter[], error: unknown) =>
  waiters.forEach((waiter) => waiter.reject(error));

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
 * `POST .../invoices/list` per {@link MAX_INVOICE_IDS} ids, and each id gets its own result (an
 * invoice the widget cannot read fails its id only). The loader reads with
 * `GET .../invoices/{invoiceId}`:
 *
 * - every id, for good, once the route answers 403, 404 or 405 (an environment without it): the
 *   switch lasts as long as the loader, that is the query client;
 * - the ids the answer leaves out, so that an unknown id is a `not-found` of the API itself;
 * - the ids of a batch whose answer it cannot read as a whole (not JSON, not a list, an invoice not
 *   asked for or twice), this batch only: the route is asked again for the next batch.
 *
 * Any other failure of the route (5xx, 401, network…) is the answer of each id of the batch.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @returns The loader.
 */
export function createInvoiceLoader(authFetch: AuthFetch, fleetId: string): InvoiceLoader {
  let pending = new Map<string, Waiter[]>();
  let scheduled = false;
  let routeMissing = false;

  const readOneByOne = (batch: Batch) => {
    for (const [invoiceId, waiters] of batch) {
      getInvoice(authFetch, fleetId, invoiceId).then(
        (result) => settle(waiters, result),
        (error: unknown) => rejectAll(waiters, error),
      );
    }
  };

  const readBatch = async (batch: Batch) => {
    if (routeMissing) return readOneByOne(batch);
    const result = await listInvoicesByIds(authFetch, fleetId, [...batch.keys()]);
    if (!result.ok) {
      if (isRouteMissing(result.error)) routeMissing = true;
      if (routeMissing || result.error.kind === 'invalid-response') return readOneByOne(batch);
      for (const waiters of batch.values()) settle(waiters, result);
      return;
    }
    const leftOut = new Map<string, readonly Waiter[]>();
    for (const [invoiceId, waiters] of batch) {
      const answer = result.data.get(invoiceId);
      if (answer) settle(waiters, answer);
      else leftOut.set(invoiceId, waiters);
    }
    readOneByOne(leftOut);
  };

  const flush = () => {
    scheduled = false;
    const entries = [...pending];
    pending = new Map();
    for (let index = 0; index < entries.length; index += MAX_INVOICE_IDS) {
      const batch = new Map(entries.slice(index, index + MAX_INVOICE_IDS));
      readBatch(batch).catch((error: unknown) => {
        for (const waiters of batch.values()) rejectAll(waiters, error);
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
