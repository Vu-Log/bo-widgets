/** The tabs of the booking list. */
export const LIST_TABS = ['alert', 'upcoming', 'ongoing', 'completed', 'cancelled'] as const;

/** A tab of the booking list. */
export type ListTab = (typeof LIST_TABS)[number];

/** The AIMA statuses the list routes are called with. */
export type AimaListStatus = 'ALERT' | 'PENDING' | 'CONFIRMED' | 'CANCELLED';

const TAB_STATUS: Record<ListTab, AimaListStatus> = {
  alert: 'ALERT',
  upcoming: 'PENDING',
  ongoing: 'CONFIRMED',
  completed: 'CONFIRMED',
  cancelled: 'CANCELLED',
};

/**
 * The AIMA status listed by a tab. Ongoing and Completed both list `CONFIRMED`: split them with
 * {@link tabOfBooking}.
 *
 * @param tab - A tab of the list.
 * @returns Its AIMA status.
 */
export const aimaStatusOfTab = (tab: ListTab): AimaListStatus => TAB_STATUS[tab];

/** What {@link tabOfBooking} reads of a booking. */
export interface TabbedBooking {
  readonly status: string;
  /** Id of the trip of the booking once a vehicle is allocated. */
  readonly journeyId: string | null;
  readonly completed: boolean;
}

/**
 * The tab a booking belongs to. A `CONFIRMED` booking is Ongoing while its trip is in progress and
 * not completed, Completed once completed and no longer in progress, and in no tab otherwise.
 *
 * @param booking - Status, trip id and completion of the booking.
 * @param tripIdsInProgress - Ids of the trips in progress in the fleet.
 * @returns The tab, or `null` when the booking is in none.
 */
export function tabOfBooking(
  booking: TabbedBooking,
  tripIdsInProgress: ReadonlySet<string>,
): ListTab | null {
  switch (booking.status) {
    case 'ALERT':
      return 'alert';
    case 'PENDING':
      return 'upcoming';
    case 'CANCELLED':
      return 'cancelled';
    case 'CONFIRMED': {
      const inProgress = booking.journeyId !== null && tripIdsInProgress.has(booking.journeyId);
      if (inProgress && !booking.completed) return 'ongoing';
      if (!inProgress && booking.completed) return 'completed';
      return null;
    }
    default:
      return null;
  }
}

/** Status of the prepayment of a booking. */
export type PrepaymentStatus =
  | 'NOT_CHARGED'
  | 'TO_VERIFY'
  | 'PENDING'
  | 'PAID'
  | 'FAILED'
  | 'REFUNDED'
  | 'CANCELLED'
  | 'UNKNOWN';

const INVOICE_PREPAYMENT_STATUS: Readonly<Record<string, PrepaymentStatus>> = {
  PENDING: 'PENDING',
  PENDING_EXTERNAL_PAYMENT: 'PENDING',
  PENDING_MANUAL_PAYMENT: 'PENDING',
  PENDING_AUTHENTICATION: 'PENDING',
  PAID: 'PAID',
  REFUSED: 'FAILED',
  ERROR: 'FAILED',
  MOP_MISSING: 'FAILED',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
};

/** What {@link prepaymentStatus} reads of the stored state of a booking. */
export interface PrepaymentState {
  readonly chargeStartedAt?: string | null | undefined;
  readonly invoiceId?: string | null | undefined;
}

/**
 * The prepayment status of a booking.
 *
 * - No claim and no invoice: `NOT_CHARGED`.
 * - A claim without an invoice: `TO_VERIFY` (an invoice may have been created).
 * - An invoice: from its status (`PAID`, `REFUSED`/`ERROR`/`MOP_MISSING` → `FAILED`, `PENDING*` →
 *   `PENDING`…), `UNKNOWN` while it is not loaded or for a status the widget does not know.
 *
 * @param state - The stored state of the booking, `null` when there is none.
 * @param invoiceStatus - Status of its invoice, `null` while not loaded.
 * @returns The prepayment status.
 */
export function prepaymentStatus(
  state: PrepaymentState | null,
  invoiceStatus: string | null,
): PrepaymentStatus {
  if (!state?.invoiceId) return state?.chargeStartedAt ? 'TO_VERIFY' : 'NOT_CHARGED';
  if (invoiceStatus === null) return 'UNKNOWN';
  return INVOICE_PREPAYMENT_STATUS[invoiceStatus] ?? 'UNKNOWN';
}

/**
 * Whether the payment of an invoice can be tried again: only after `REFUSED` or `ERROR`.
 *
 * @param invoiceStatus - Status of the invoice.
 * @returns `true` when a retry is allowed.
 */
export const canRetryPayment = (invoiceStatus: string | null): boolean =>
  invoiceStatus === 'REFUSED' || invoiceStatus === 'ERROR';

/** What {@link isSettledInvoice} reads of a stored state. */
export interface StoredInvoiceState {
  readonly invoiceStatus?: string | null | undefined;
  readonly refundStartedAt?: string | null | undefined;
  readonly refundedAt?: string | null | undefined;
}

/**
 * Whether the list trusts the stored status of an invoice without reading it again (one call per row otherwise, AIMA
 * has no read of several invoices at once). A `REFUNDED` invoice never changes. A `PAID` one changes by a refund, and
 * the widget records its own refunds in the refund fields, not in `invoiceStatus`: a stored `PAID` is trusted only
 * while no refund was started, so the list reads the invoice of a refunded booking again and stores its new status. A
 * refund made outside the widget is not seen by the list, only by the dialogs, which always read the invoice live.
 *
 * @param state - The stored state of the booking, `null` or `undefined` without one.
 * @returns `true` for a stored `REFUNDED`, or a stored `PAID` with no refund started.
 */
export function isSettledInvoice(state: StoredInvoiceState | null | undefined): boolean {
  if (state?.invoiceStatus === 'REFUNDED') return true;
  return state?.invoiceStatus === 'PAID' && !state.refundStartedAt && !state.refundedAt;
}

/** Status of the credits granted for a prepaid booking. */
export type CreditsStatus = 'REVOKED' | 'GRANTED' | 'PENDING_GRANT' | 'PENDING_PREPAYMENT';

/** What {@link creditsStatus} reads. */
export interface CreditsInput {
  readonly creditsAdded?: boolean | undefined;
  readonly creditsRevoked?: boolean | undefined;
  /** Status of the prepayment invoice, `null` without one or while not loaded. */
  readonly invoiceStatus: string | null;
  /** Whether the booking is cancelled. */
  readonly cancelled: boolean;
}

/**
 * The credits status of a booking: `REVOKED` when revoked, else `GRANTED` when added, else (for a
 * booking that is not cancelled) `PENDING_GRANT` once the invoice is paid, `PENDING_PREPAYMENT`
 * before. A cancelled booking without credits added has none.
 *
 * @param input - Flags of the stored state, invoice status and cancellation.
 * @returns The credits status, or `null` when there is none.
 */
export function creditsStatus(input: CreditsInput): CreditsStatus | null {
  if (input.creditsRevoked) return 'REVOKED';
  if (input.creditsAdded) return 'GRANTED';
  if (input.cancelled) return null;
  return input.invoiceStatus === 'PAID' ? 'PENDING_GRANT' : 'PENDING_PREPAYMENT';
}
