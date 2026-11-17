import { getInvoice, retryPayment } from '../../api/billing';
import type { ApiError } from '../../api/http';
import { canRetryPayment } from '../../domain/statuses';
import type { BookingStateDoc } from '../../storage/booking-state';
import type { MoneyDeps } from './charge';
import { EVENTS } from './rules';
import { refuse, withEvents, writeOver, type WriteFailure } from './writes';

/**
 * The outcome of a retry of the payment of a prepayment invoice.
 *
 * - `retried`: the API accepted it; `status` is the status read again (`null` when that read
 *   failed); `recordFailure` when the journal could not be written.
 * - `not-retryable`: the live invoice is not `REFUSED` nor `ERROR`: nothing was sent.
 * - `failed`: the invoice could not be read, or the API refused the retry.
 */
export type RetryOutcome =
  | {
      readonly kind: 'retried';
      readonly status: string | null;
      readonly doc: BookingStateDoc | null;
      readonly recordFailure: WriteFailure | null;
    }
  | { readonly kind: 'not-retryable'; readonly status: string }
  | { readonly kind: 'failed'; readonly error: ApiError };

/**
 * Tries the payment of the prepayment invoice of a booking again, after reading its live status:
 * only `REFUSED` or `ERROR` are tried again. Then reads the invoice again and records the attempt
 * and the new status in the document.
 *
 * @param deps - API, storage, operator and clock.
 * @param input - The booking and its invoice (from its document).
 * @returns The outcome; never throws for a failure of the API or the storage.
 */
export async function retryPrepayment(
  deps: MoneyDeps,
  input: { readonly bookingId: string; readonly invoiceId: string },
): Promise<RetryOutcome> {
  const invoice = await getInvoice(deps.authFetch, deps.fleetId, input.invoiceId);
  if (!invoice.ok) return { kind: 'failed', error: invoice.error };
  if (!canRetryPayment(invoice.data.status)) {
    return { kind: 'not-retryable', status: invoice.data.status };
  }
  const retried = await retryPayment(deps.authFetch, deps.fleetId, input.invoiceId);
  if (!retried.ok) return { kind: 'failed', error: retried.error };

  const after = await getInvoice(deps.authFetch, deps.fleetId, input.invoiceId);
  const status = after.ok ? after.data.status : null;
  const recorded = await writeOver(deps, input.bookingId, (current) => {
    if (current.value.invoiceId !== input.invoiceId) return refuse('other-invoice');
    const at = deps.now().toISOString();
    return {
      mode: 'update',
      patch: {
        ...(status === null ? {} : { invoiceStatus: status, invoiceStatusFetchedAt: at }),
        events: withEvents(current.value.events, [
          {
            at,
            by: deps.userId,
            type: EVENTS.paymentRetried,
            details: { invoiceId: input.invoiceId, status },
          },
        ]),
      },
    };
  });
  return {
    kind: 'retried',
    status,
    doc: recorded.ok ? recorded.value : null,
    recordFailure: recorded.ok ? null : recorded.error,
  };
}
