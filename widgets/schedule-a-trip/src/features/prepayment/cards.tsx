import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import type { MessageKey } from '../../i18n';
import type { BookingEvent } from '../../storage/booking-state';
import type { BookingContext } from '../extensions';
import { CreditsCell, PrepaymentStatusCell, RegularizationCell } from './cells';
import { EVENTS, isArchived } from './rules';
import { prepaymentDialogs } from './store';
import { usePrepaymentEnv } from './use-prepayment-env';

function CardFrame({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle2" component="h3" gutterBottom>
          {title}
        </Typography>
        {children}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '40% 1fr', gap: 1, alignItems: 'center' }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

/** The explicit empty state of a card: nothing recorded, or archived data. Never a spinner. */
function EmptyState({ ctx }: { readonly ctx: BookingContext }) {
  const { i18n } = usePrepaymentEnv();
  const archived = isArchived(ctx.booking, ctx.state, new Date());
  return (
    <Typography variant="body2" color="text.secondary">
      {i18n.t(archived ? 'prepayment.tooltip.archived' : 'prepayment.card.nothingRecorded')}
    </Typography>
  );
}

/**
 * The payment card of the detail: prepayment, invoice, amounts (charged, computed, warnings
 * accepted), credits, wallet, refund and regularization.
 *
 * @param props - The booking.
 * @returns The card.
 */
export function PaymentCard({ ctx }: { readonly ctx: BookingContext }) {
  const { i18n, formatAmount } = usePrepaymentEnv();
  const value = ctx.state?.value;
  const title = i18n.t('prepayment.card.payment');
  if (ctx.state === null || value === undefined) {
    return (
      <CardFrame title={title}>
        {ctx.state === null ? <EmptyState ctx={ctx} /> : <Typography variant="body2">{i18n.t('common.loading')}</Typography>}
      </CardFrame>
    );
  }
  return (
    <CardFrame title={title}>
      <Stack spacing={1}>
        <Field label={i18n.t('prepayment.column.status')}>
          <PrepaymentStatusCell ctx={ctx} />
        </Field>
        {value.invoiceId && <Field label={i18n.t('prepayment.card.invoice')}>{value.invoiceId}</Field>}
        {value.chargeAmount ? (
          <Field label={i18n.t('prepayment.column.amount')}>{formatAmount(value.chargeAmount)}</Field>
        ) : null}
        {value.computedAmount !== undefined && value.computedAmount !== null && (
          <Field label={i18n.t('prepayment.card.computed')}>{formatAmount(value.computedAmount)}</Field>
        )}
        {(value.amountWarnings ?? []).length > 0 && (
          <Field label={i18n.t('prepayment.card.warnings')}>
            {(value.amountWarnings ?? []).map((warning) => i18n.t(`prepayment.warningAccepted.${warning}`)).join(' · ')}
          </Field>
        )}
        <Field label={i18n.t('prepayment.column.credits')}>
          <CreditsCell ctx={ctx} />
        </Field>
        {value.walletId && <Field label={i18n.t('prepayment.card.wallet')}>{value.walletId}</Field>}
        {value.refundedAt && (
          <Field label={i18n.t('prepayment.card.refundedAt')}>
            {i18n.formatDate(new Date(value.refundedAt), 'Pp')}
          </Field>
        )}
        {value.toRegularize && (
          <Field label={i18n.t('prepayment.column.regularization')}>
            <RegularizationCell ctx={ctx} />
          </Field>
        )}
        {value.regularizationPending === true && (
          <Box>
            <Button size="small" variant="outlined" onClick={() => prepaymentDialogs.open({ action: 'regularize', ctx })}>
              {i18n.t('prepayment.action.regularize')}
            </Button>
          </Box>
        )}
        {value.regularizedAt && (
          <Box>
            <Button size="small" onClick={() => prepaymentDialogs.open({ action: 'undo-regularization', ctx })}>
              {i18n.t('prepayment.action.undoRegularization')}
            </Button>
          </Box>
        )}
      </Stack>
    </CardFrame>
  );
}

/**
 * The internal notes card of the detail, with its edit button (not on archived data).
 *
 * @param props - The booking.
 * @returns The card.
 */
export function InternalNotesCard({ ctx }: { readonly ctx: BookingContext }) {
  const { i18n } = usePrepaymentEnv();
  const title = i18n.t('prepayment.notes.title');
  if (ctx.state === undefined) {
    return (
      <CardFrame title={title}>
        <Typography variant="body2">{i18n.t('common.loading')}</Typography>
      </CardFrame>
    );
  }
  const archived = isArchived(ctx.booking, ctx.state, new Date());
  const notes = ctx.state?.value.internalNotes ?? '';
  return (
    <CardFrame title={title}>
      <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
        {notes === '' ? (
          <EmptyState ctx={ctx} />
        ) : (
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {notes}
          </Typography>
        )}
        {!archived && (
          <Button size="small" onClick={() => prepaymentDialogs.open({ action: 'notes', ctx })}>
            {i18n.t('prepayment.action.notes')}
          </Button>
        )}
      </Stack>
    </CardFrame>
  );
}

const EVENT_KEYS: Readonly<Record<string, MessageKey>> = {
  'charge-started': 'prepayment.event.chargeStarted',
  'charge-released': 'prepayment.event.chargeReleased',
  [EVENTS.charged]: 'prepayment.event.charged',
  [EVENTS.chargeAttached]: 'prepayment.event.chargeAttached',
  [EVENTS.paymentRetried]: 'prepayment.event.paymentRetried',
  [EVENTS.refundStarted]: 'prepayment.event.refundStarted',
  [EVENTS.refunded]: 'prepayment.event.refunded',
  [EVENTS.feeStarted]: 'prepayment.event.feeStarted',
  [EVENTS.feeCharged]: 'prepayment.event.feeCharged',
  [EVENTS.feeReleased]: 'prepayment.event.feeReleased',
  [EVENTS.feeConfirmed]: 'prepayment.event.feeConfirmed',
  [EVENTS.feeSkipped]: 'prepayment.event.feeSkipped',
  [EVENTS.creditsStarted]: 'prepayment.event.creditsStarted',
  [EVENTS.creditsRevoked]: 'prepayment.event.creditsRevoked',
  [EVENTS.creditsSkipped]: 'prepayment.event.creditsSkipped',
  [EVENTS.refundCompleted]: 'prepayment.event.refundCompleted',
  [EVENTS.regularized]: 'prepayment.event.regularized',
  [EVENTS.regularizationUndone]: 'prepayment.event.regularizationUndone',
  [EVENTS.notesSaved]: 'prepayment.event.notesSaved',
};

/**
 * The journal entries, newest first.
 *
 * @param events - The journal of a document (oldest first, as written).
 * @returns A new array, newest first.
 */
export const newestFirst = (events: readonly BookingEvent[] | undefined): BookingEvent[] =>
  [...(events ?? [])].reverse();

/**
 * The journal card of the detail: who did what and when, newest first, with the entries of the
 * scheduler ("Scheduler" as author). An entry of an unknown type shows its type.
 *
 * @param props - The booking.
 * @returns The card.
 */
export function JournalCard({ ctx }: { readonly ctx: BookingContext }) {
  const { i18n } = usePrepaymentEnv();
  const title = i18n.t('prepayment.card.journal');
  if (ctx.state === undefined) {
    return (
      <CardFrame title={title}>
        <Typography variant="body2">{i18n.t('common.loading')}</Typography>
      </CardFrame>
    );
  }
  const events = newestFirst(ctx.state?.value.events);
  return (
    <CardFrame title={title}>
      {events.length === 0 ? (
        <EmptyState ctx={ctx} />
      ) : (
        <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1 }}>
          {events.map((event, index) => {
            const key = EVENT_KEYS[event.type];
            return (
              <Box
                component="li"
                key={`${event.at}:${event.type}:${index}`}
                sx={{ display: 'grid', gridTemplateColumns: '9rem 1fr', gap: 1 }}
              >
                <Typography component="time" dateTime={event.at} variant="body2" color="text.secondary">
                  {i18n.formatDate(new Date(event.at), 'Pp')}
                </Typography>
                <Typography variant="body2">
                  {key ? i18n.t(key) : event.type}
                  {' · '}
                  {event.by ?? i18n.t('prepayment.event.scheduler')}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
    </CardFrame>
  );
}
