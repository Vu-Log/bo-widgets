import { useEffect } from 'react';
import type { Invoice } from '../../api/billing';
import { queryKeys } from '../../query/keys';
import {
  readBookingState,
  type BookingStateDoc,
  type StorageFailure,
  type StorageResult,
} from '../../storage/booking-state';
import type { BookingContext } from '../extensions';
import type { MoneyDeps } from './charge';
import { usePrepaymentEnv } from './use-prepayment-env';
import { refuse, writeOver, type RefusedWrite } from './writes';

/**
 * Writes the live status of the prepayment invoice of a booking into its stored state
 * (`invoiceStatus`, `invoiceStatusFetchedAt`), the cache the contract shares with the scheduler and
 * the rules of the list read (the filters, the pre-allocation that waits for `PAID`). Over the
 * version read (`ifVersion`); refused when the document now names another invoice or already holds
 * that status. Never creates a document.
 *
 * @param deps - Collection and clock.
 * @param bookingId - The AIMA booking id.
 * @param invoice - The invoice read from the API: its id and status.
 * @returns The document written, or why it was not.
 */
export function recordInvoiceStatus(
  deps: Pick<MoneyDeps, 'collection' | 'now' | 'sleep'>,
  bookingId: string,
  invoice: Pick<Invoice, 'id' | 'status'>,
): Promise<StorageResult<BookingStateDoc, StorageFailure | RefusedWrite>> {
  return writeOver(deps, bookingId, (current) => {
    if (current.value.invoiceId !== invoice.id) return refuse('other-invoice');
    if (current.value.invoiceStatus === invoice.status) return refuse('changed');
    return {
      mode: 'update',
      patch: { invoiceStatus: invoice.status, invoiceStatusFetchedAt: deps.now().toISOString() },
    };
  });
}

/** The writes in flight, by fleet, booking and status: several cells of a row read the same invoice. */
const inFlight = new Set<string>();
/** The write-backs run one after the other: the storage takes about one write per second. */
let queue: Promise<unknown> = Promise.resolve();
/** Pause of the write-backs after a `rate-limited` answer, so that they leave room for the actions. */
export const SYNC_COOLDOWN_MS = 60_000;
let pausedUntil = 0;

const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
};

/** What a write-back did with the cache of the row. */
type SyncOutcome =
  | { readonly kind: 'written' | 'read-again'; readonly doc: BookingStateDoc | null }
  | { readonly kind: 'skipped' }
  | { readonly kind: 'failed'; readonly failure: StorageFailure };

/**
 * Writes the status, then gives the document to show: the one written, or the one read again when
 * another write got there first or the outcome of the write is unknown.
 */
async function syncOnce(
  deps: Pick<MoneyDeps, 'collection' | 'now' | 'sleep'>,
  bookingId: string,
  invoice: Pick<Invoice, 'id' | 'status'>,
): Promise<SyncOutcome> {
  if (Date.now() < pausedUntil) return { kind: 'skipped' };
  const written = await recordInvoiceStatus(deps, bookingId, invoice);
  if (written.ok) return { kind: 'written', doc: written.value };
  const failure = written.error;
  if (failure.kind === 'rate-limited') pausedUntil = Date.now() + SYNC_COOLDOWN_MS;
  if (failure.kind !== 'refused' && failure.kind !== 'unknown-outcome') return { kind: 'failed', failure };
  // Another write got there first, or this one may have landed: show the document as it is now.
  const fresh = await readBookingState(deps.collection, bookingId);
  return fresh.ok ? { kind: 'read-again', doc: fresh.value } : { kind: 'failed', failure: fresh.error };
}

/**
 * Keeps the stored status of the invoice of a row equal to the live one: when the invoice read
 * differs from the document, writes it once ({@link recordInvoiceStatus}) and puts the document in
 * the cache of the row (read again when another write got there first or its outcome is unknown).
 * The write-backs of the rows run one at a time, and pause for {@link SYNC_COOLDOWN_MS} after a
 * `rate-limited` answer. A failure is logged, never retried in a loop: the next mount of the row
 * tries again.
 *
 * @param ctx - The row.
 * @param invoice - Its live invoice, `undefined` while not loaded.
 */
export function useInvoiceStatusSync(ctx: BookingContext, invoice: Invoice | undefined): void {
  const env = usePrepaymentEnv();
  const { deps, fleetId, queryClient, guard, logOutcome } = env;
  const value = ctx.state?.value;
  const bookingId = ctx.booking.id;
  const stale =
    invoice !== undefined && value?.invoiceId === invoice.id && value.invoiceStatus !== invoice.status;
  const invoiceId = stale ? invoice.id : null;
  const status = stale ? invoice.status : null;

  useEffect(() => {
    if (!deps || !fleetId || invoiceId === null || status === null) return;
    const key = `${fleetId}/${bookingId}/${status}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    void guard('invoice-status', bookingId, () =>
      enqueue(() => syncOnce(deps, bookingId, { id: invoiceId, status })),
    ).then((result) => {
      inFlight.delete(key);
      if (!result.ok) return;
      const outcome = result.value;
      if (outcome.kind === 'failed') logOutcome('invoice-status', bookingId, outcome.failure);
      else if (outcome.kind !== 'skipped') {
        queryClient.setQueryData(queryKeys.bookingState(fleetId, bookingId), outcome.doc);
      }
    });
  }, [deps, fleetId, bookingId, invoiceId, status, queryClient, guard, logOutcome]);
}

/** Forgets the pause and the writes in flight: for tests only. */
export function resetInvoiceStatusSync(): void {
  inFlight.clear();
  pausedUntil = 0;
  queue = Promise.resolve();
}
