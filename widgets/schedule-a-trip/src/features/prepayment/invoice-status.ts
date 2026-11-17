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

/**
 * Keeps the stored status of the invoice of a row equal to the live one: when the invoice read
 * differs from the document, writes it once ({@link recordInvoiceStatus}) and puts the document in
 * the cache of the row (read again when another write got there first). A failure is logged,
 * never retried in a loop: the next read of the invoice tries again.
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
      recordInvoiceStatus(deps, bookingId, { id: invoiceId, status }),
    ).then(async (result) => {
      inFlight.delete(key);
      if (!result.ok) return;
      const stateKey = queryKeys.bookingState(fleetId, bookingId);
      if (result.value.ok) {
        queryClient.setQueryData(stateKey, result.value.value);
        return;
      }
      if (result.value.error.kind !== 'refused') {
        logOutcome('invoice-status', bookingId, result.value.error);
        return;
      }
      // Another write got there first: show the document as it is now.
      const fresh = await readBookingState(deps.collection, bookingId);
      if (fresh.ok) queryClient.setQueryData(stateKey, fresh.value);
      else logOutcome('invoice-status', bookingId, fresh.error);
    });
  }, [deps, fleetId, bookingId, invoiceId, status, queryClient, guard, logOutcome]);
}
