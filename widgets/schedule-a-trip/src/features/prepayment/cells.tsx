import { Box, Tooltip, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@vulog/bo-widget-react';
import type { Invoice } from '../../api/billing';
import { computeChargeAmount, type ChargeSettings } from '../../domain/charge-amount';
import { creditsStatus, isSettledInvoice, type CreditsStatus } from '../../domain/statuses';
import type { MessageKey } from '../../i18n';
import { invoiceQueryOptions } from '../../query/queries';
import { SkeletonCell } from '../../ui/SkeletonCell';
import { StatusChip, type StatusTone } from '../../ui/StatusChip';
import type { BookingContext } from '../extensions';
import { useInvoiceStatusSync } from './invoice-status';
import {
  prepaymentDisplay,
  prepaymentEligibility,
  schedulerErrorNames,
  UPCOMING_TABS,
  type PrepaymentDisplay,
} from './rules';
import { usePrepaymentEnv } from './use-prepayment-env';

type Tone = StatusTone;

/** Label and colour of each prepayment status. */
export const PREPAYMENT_CHIPS: Readonly<
  Record<Exclude<PrepaymentDisplay, 'LOADING'>, { key: MessageKey; color: Tone }>
> = {
  NOT_CHARGED: { key: 'prepayment.status.notCharged', color: 'warning' },
  TO_VERIFY: { key: 'prepayment.status.toVerify', color: 'warning' },
  PENDING: { key: 'prepayment.status.pending', color: 'info' },
  PAID: { key: 'prepayment.status.paid', color: 'success' },
  FAILED: { key: 'prepayment.status.failed', color: 'error' },
  REFUNDED: { key: 'prepayment.status.refunded', color: 'default' },
  CANCELLED: { key: 'prepayment.status.cancelled', color: 'default' },
  UNKNOWN: { key: 'prepayment.status.unknown', color: 'default' },
  ARCHIVED: { key: 'prepayment.status.archived', color: 'default' },
  NO_DATA: { key: 'prepayment.status.noData', color: 'default' },
  NONE_FROM_WIDGET: { key: 'prepayment.status.noneFromWidget', color: 'default' },
  NOT_REQUIRED: { key: 'prepayment.status.notRequired', color: 'default' },
};

const TOOLTIPS: Partial<Record<PrepaymentDisplay, MessageKey>> = {
  ARCHIVED: 'prepayment.tooltip.archived',
  NO_DATA: 'prepayment.tooltip.noData',
  TO_VERIFY: 'prepayment.tooltip.toVerify',
};

/** Label and colour of each credits status. */
export const CREDITS_CHIPS: Readonly<Record<CreditsStatus, { key: MessageKey; color: Tone }>> = {
  REVOKED: { key: 'prepayment.credits.revoked', color: 'default' },
  GRANTED: { key: 'prepayment.credits.granted', color: 'success' },
  PENDING_GRANT: { key: 'prepayment.credits.pendingGrant', color: 'info' },
  PENDING_PREPAYMENT: { key: 'prepayment.credits.pendingPrepayment', color: 'default' },
};

/**
 * The live invoice of a row, when its document names one and its stored status can still change
 * ({@link isSettledInvoice}): its own query, so that a status that arrives only renders its cell. A
 * status that changed is written back to the stored state ({@link useInvoiceStatusSync}).
 *
 * @param ctx - The row.
 * @returns The invoice query (disabled without an invoice, or for a settled stored status).
 */
export function useRowInvoice(ctx: BookingContext) {
  const authFetch = useAuthFetch();
  const { fleetId } = usePrepaymentEnv();
  const invoiceId = ctx.state?.value.invoiceId ?? null;
  const invoice = useQuery({
    ...invoiceQueryOptions(authFetch, fleetId ?? '', invoiceId ?? ''),
    enabled: Boolean(fleetId && invoiceId) && !isSettledInvoice(ctx.state?.value),
  });
  useInvoiceStatusSync(ctx, invoice.data);
  return invoice;
}

const liveStatus = (invoice: Invoice | undefined): string | null => invoice?.status ?? null;

/**
 * The prepayment status of a row, as a chip: a skeleton while the document or the customer loads,
 * the cached status of the document until the live invoice arrives.
 *
 * @param props - The row.
 * @returns The cell.
 */
export function PrepaymentStatusCell({ ctx }: { readonly ctx: BookingContext }) {
  const { i18n } = usePrepaymentEnv();
  const invoice = useRowInvoice(ctx);
  const display = prepaymentDisplay(ctx, liveStatus(invoice.data), new Date());
  if (display === 'LOADING') return <SkeletonCell />;
  const chip = PREPAYMENT_CHIPS[display];
  const label = <StatusChip tone={chip.color} label={i18n.t(chip.key)} />;
  const tooltip = TOOLTIPS[display];
  return tooltip ? (
    <Tooltip title={i18n.t(tooltip)}>
      <span>{label}</span>
    </Tooltip>
  ) : (
    label
  );
}

/**
 * The credits status of a row, as a chip: "Awaiting prepayment" for a booking to prepay that has
 * no document yet; a dash for a business booking, a cancelled booking without credits, or a
 * booking the widget has no data for.
 *
 * @param props - The row.
 * @returns The cell.
 */
export function CreditsCell({ ctx }: { readonly ctx: BookingContext }) {
  const { i18n } = usePrepaymentEnv();
  const invoice = useRowInvoice(ctx);
  if (ctx.state === undefined) return <SkeletonCell />;
  if (ctx.state === null) {
    // No document: the credits wait for the prepayment of a booking still to prepay.
    const display = prepaymentDisplay(ctx, null, new Date());
    if (display === 'LOADING') return <SkeletonCell />;
    if (display !== 'NOT_CHARGED') return <span>–</span>;
    const chip = CREDITS_CHIPS.PENDING_PREPAYMENT;
    return <StatusChip tone={chip.color} label={i18n.t(chip.key)} />;
  }
  if (ctx.state.value.isB2B === true) return <span>–</span>;
  if (prepaymentEligibility(ctx.booking, ctx.customer).kind === 'b2b') return <span>–</span>;
  const value = ctx.state.value;
  const status = creditsStatus({
    creditsAdded: value.creditsAdded,
    creditsRevoked: value.creditsRevoked,
    invoiceStatus: liveStatus(invoice.data) ?? value.invoiceStatus ?? null,
    cancelled: ctx.tab === 'cancelled',
  });
  if (status === null) return <span>–</span>;
  const chip = CREDITS_CHIPS[status];
  return <StatusChip tone={chip.color} label={i18n.t(chip.key)} />;
}

/**
 * The estimated prepayment of a row with nothing charged yet: the amount the charge dialog would
 * propose ({@link computeChargeAmount}), `null` when there is none (a tab where no charge is
 * offered, a charge or a claim already, a business booking, the customer not loaded yet, no planned
 * return, settings missing or invalid).
 *
 * @param ctx - The row.
 * @param settings - The valid settings, `null` otherwise.
 * @param now - The current date.
 * @returns The amount, or `null`.
 */
export function estimatedAmount(
  ctx: BookingContext,
  settings: ChargeSettings | null,
  now: Date,
): number | null {
  if (settings === null || ctx.booking.plannedReturnDate === null) return null;
  if (!UPCOMING_TABS.includes(ctx.tab)) return null;
  if (prepaymentDisplay(ctx, null, now) !== 'NOT_CHARGED') return null;
  // A document does not always say it is a business booking (a pre-allocation): ask the customer.
  const eligibility = prepaymentEligibility(ctx.booking, ctx.customer).kind;
  if (eligibility === 'b2b' || eligibility === 'loading') return null;
  return computeChargeAmount(new Date(ctx.booking.startDate), new Date(ctx.booking.plannedReturnDate), settings);
}

/**
 * The amount charged, in the currency of the fleet, with the warnings accepted in a tooltip. With
 * nothing charged yet, the estimated amount ({@link estimatedAmount}), muted and marked "≈".
 *
 * @param props - The row.
 * @returns The cell.
 */
export function AmountCell({ ctx }: { readonly ctx: BookingContext }) {
  const { i18n, formatAmount, settings } = usePrepaymentEnv();
  if (ctx.state === undefined) return <SkeletonCell />;
  const amount = ctx.state?.value.chargeAmount;
  if (!amount) {
    const estimate = estimatedAmount(ctx, settings, new Date());
    if (estimate === null) return <span>–</span>;
    return (
      <Tooltip title={i18n.t('prepayment.amount.estimated')}>
        <Box component="span" data-estimated="" sx={{ color: 'text.secondary' }}>
          ≈ {formatAmount(estimate)}
        </Box>
      </Tooltip>
    );
  }
  const warnings = ctx.state?.value.amountWarnings ?? [];
  const text = <span>{formatAmount(amount)}</span>;
  if (warnings.length === 0) return text;
  return (
    <Tooltip
      title={warnings
        .map((warning) => i18n.t(`prepayment.warningAccepted.${warning}`))
        .join(' · ')}
    >
      <Box component="span" sx={{ textDecoration: 'underline dotted' }}>
        {formatAmount(amount)}
      </Box>
    </Tooltip>
  );
}

/**
 * The regularization of a cancelled booking: "To regularize (amount)" while pending, "Regularized
 * on date" with the author and the note in a tooltip once done.
 *
 * @param props - The row.
 * @returns The cell.
 */
export function RegularizationCell({ ctx }: { readonly ctx: BookingContext }) {
  const { i18n, formatAmount } = usePrepaymentEnv();
  if (ctx.state === undefined) return <SkeletonCell />;
  const value = ctx.state?.value;
  if (!value?.toRegularize) return <span>–</span>;
  if (value.regularizationPending === true) {
    return (
      <StatusChip
        tone="error"
        label={i18n.t('prepayment.regularization.pending', {
          amount: formatAmount(value.toRegularize.missingAmount),
        })}
      />
    );
  }
  if (!value.regularizedAt) return <span>–</span>;
  const tooltip = [
    i18n.t('prepayment.regularization.by', { user: value.regularizedBy ?? '–' }),
    value.regularizationNote ?? '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Tooltip title={tooltip}>
      <span>
        <StatusChip
          tone="success"
          label={i18n.t('prepayment.regularization.done', {
            date: i18n.formatDate(new Date(value.regularizedAt), 'P'),
          })}
        />
      </span>
    </Tooltip>
  );
}

const SCHEDULER_ERROR_KEYS: Readonly<Record<string, MessageKey>> = {
  vehicleMissing: 'prepayment.schedulerError.vehicleMissing',
  enableFailed: 'prepayment.schedulerError.enableFailed',
  allocationFailed: 'prepayment.schedulerError.allocationFailed',
  creditsFailed: 'prepayment.schedulerError.creditsFailed',
};

/**
 * The errors the scheduler recorded for a booking, as chips with their date in a tooltip.
 *
 * @param props - The row.
 * @returns The cell, empty without errors.
 */
export function SchedulerErrorsCell({ ctx }: { readonly ctx: BookingContext }) {
  const { i18n } = usePrepaymentEnv();
  if (ctx.state === undefined) return <SkeletonCell />;
  const names = schedulerErrorNames(ctx.state?.value);
  if (names.length === 0) return null;
  const errors = ctx.state?.value.schedulerErrors ?? {};
  return (
    <Box sx={{ display: 'flex', gap: 0.5, overflow: 'hidden' }}>
      {names.map((name) => {
        const at = errors[name];
        const key = SCHEDULER_ERROR_KEYS[name];
        return (
          <Tooltip
            key={name}
            title={typeof at === 'string' ? i18n.formatDate(new Date(at), 'Pp') : ''}
          >
            <span>
              <StatusChip tone="error" label={key ? i18n.t(key) : name} />
            </span>
          </Tooltip>
        );
      })}
    </Box>
  );
}

/**
 * The internal notes of a row, on one line.
 *
 * @param props - The row.
 * @returns The cell.
 */
export function InternalNotesCell({ ctx }: { readonly ctx: BookingContext }) {
  if (ctx.state === undefined) return <SkeletonCell />;
  const notes = ctx.state?.value.internalNotes ?? '';
  if (notes === '') return <span>–</span>;
  return (
    <Tooltip title={notes}>
      <Typography variant="body2" noWrap component="span">
        {notes}
      </Typography>
    </Tooltip>
  );
}
