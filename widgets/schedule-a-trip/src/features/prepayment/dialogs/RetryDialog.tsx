import { Button } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@vulog/bo-widget-react';
import { useState } from 'react';
import { canRetryPayment } from '../../../domain/statuses';
import { invoiceQueryOptions } from '../../../query/queries';
import type { BookingContext } from '../../extensions';
import { actionErrorText, storageErrorText, type Text } from '../messages';
import { retryPrepayment, type RetryOutcome } from '../retry';
import { usePrepaymentEnv } from '../use-prepayment-env';
import { DialogFrame, TextAlert } from './DialogFrame';

/**
 * Why the payment of an invoice cannot be tried again, by status.
 *
 * @param status - The live status of the invoice.
 * @returns The message to show.
 */
export function notRetryableText(status: string): Text {
  if (status.startsWith('PENDING')) return { key: 'prepayment.retry.inProgress' };
  if (status === 'MOP_MISSING') return { key: 'prepayment.retry.mopMissing' };
  if (status === 'PAID') return { key: 'prepayment.retry.paid' };
  return { key: 'prepayment.retry.notRetryable', params: { status } };
}

function outcomeText(outcome: RetryOutcome): { severity: 'success' | 'warning' | 'error'; text: Text } {
  switch (outcome.kind) {
    case 'retried':
      return outcome.recordFailure
        ? { severity: 'warning', text: storageErrorText(outcome.recordFailure) }
        : { severity: 'success', text: { key: 'prepayment.retry.done' } };
    case 'not-retryable':
      return { severity: 'warning', text: notRetryableText(outcome.status) };
    case 'failed':
      return { severity: 'error', text: actionErrorText('retry', outcome.error) };
  }
}

/**
 * The retry of the payment of the prepayment invoice. It reads the live invoice: only `REFUSED` and
 * `ERROR` can be tried again, any other status is explained (payment in progress, payment method
 * missing, already paid…).
 *
 * @param props - The row and how to close.
 * @returns The dialog.
 */
export function RetryDialog({ ctx, onClose }: { readonly ctx: BookingContext; readonly onClose: () => void }) {
  const env = usePrepaymentEnv();
  const authFetch = useAuthFetch();
  const { i18n, deps, formatAmount } = env;
  const invoiceId = ctx.state?.value.invoiceId ?? null;
  const invoice = useQuery({
    ...invoiceQueryOptions(authFetch, env.fleetId ?? '', invoiceId ?? ''),
    enabled: Boolean(env.fleetId && invoiceId),
    staleTime: 0,
  });
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<RetryOutcome | null>(null);
  const title = i18n.t('prepayment.retry.title');

  const run = async () => {
    if (!deps || !invoiceId) return;
    setRunning(true);
    const result = await retryPrepayment(deps, { bookingId: ctx.booking.id, invoiceId });
    setRunning(false);
    setOutcome(result);
    await env.refresh(ctx.booking.id, result.kind === 'retried' ? result.doc : null);
  };

  if (outcome) {
    const { severity, text } = outcomeText(outcome);
    return (
      <DialogFrame title={title} onClose={onClose} i18n={i18n}>
        <TextAlert severity={severity} text={text} i18n={i18n} />
      </DialogFrame>
    );
  }
  let body: Text | null = null;
  let severity: 'error' | 'warning' | 'info' = 'info';
  if (env.blocker) {
    body = env.blocker;
    severity = 'error';
  } else if (!invoiceId) {
    body = { key: 'prepayment.retry.noInvoice' };
    severity = 'warning';
  } else if (invoice.isError) {
    body = { key: 'prepayment.retry.unreadable' };
    severity = 'error';
  } else if (invoice.data && !canRetryPayment(invoice.data.status)) {
    body = notRetryableText(invoice.data.status);
    severity = 'warning';
  } else if (invoice.data) {
    body = {
      key: 'prepayment.retry.confirm',
      params: { invoiceId: invoice.data.id, amount: formatAmount(invoice.data.amount) },
    };
  }
  const canRun = body !== null && severity === 'info' && deps !== null && !running;
  return (
    <DialogFrame
      title={title}
      onClose={onClose}
      busy={running || invoice.isLoading}
      i18n={i18n}
      actions={
        <Button variant="contained" disabled={!canRun} onClick={() => void run()}>
          {i18n.t('prepayment.action.retry')}
        </Button>
      }
    >
      {body && <TextAlert severity={severity} text={body} i18n={i18n} />}
    </DialogFrame>
  );
}
