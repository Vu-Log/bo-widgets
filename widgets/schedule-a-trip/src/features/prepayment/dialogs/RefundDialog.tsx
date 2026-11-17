import { Button, List, ListItem, ListItemText } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import type { MessageKey } from '../../../i18n';
import { readBookingState } from '../../../storage/booking-state';
import type { RefundKind } from '../../../domain/refund-policy';
import type { BookingContext } from '../../extensions';
import { actionErrorText, storageErrorText, type Text } from '../messages';
import {
  executeRefund,
  planRefund,
  type FeeDecision,
  type RefundOutcome,
  type RefundPlan,
  type RefundPlanFailure,
} from '../refund';
import { usePrepaymentEnv } from '../use-prepayment-env';
import { DialogFrame, TextAlert } from './DialogFrame';

const POLICY_KEYS: Readonly<Record<RefundKind, MessageKey>> = {
  'full-refund': 'prepayment.refund.policy.full',
  'refund-with-fee': 'prepayment.refund.policy.fee',
  'refund-with-fee-and-credits-revocation': 'prepayment.refund.policy.feeAndCredits',
};

/**
 * Why a refund cannot be planned.
 *
 * @param failure - The failure of {@link planRefund}.
 * @returns The message to show.
 */
export function planFailureText(failure: RefundPlanFailure): Text {
  switch (failure.kind) {
    case 'no-document':
    case 'no-invoice':
      return { key: 'prepayment.refund.noInvoice' };
    case 'b2b':
      return { key: 'prepayment.charge.b2b' };
    case 'complete':
      return { key: 'prepayment.refund.complete' };
    case 'no-cancellation-date':
      return { key: 'prepayment.refund.noCancellationDate' };
    case 'invoice-not-paid':
      return { key: 'prepayment.refund.notPaid', params: { status: failure.status } };
    case 'nothing-to-refund':
      return { key: 'prepayment.refund.nothingToRefund' };
    case 'missing-billing':
      return { key: 'prepayment.refund.missingBilling' };
    case 'wallet-not-found':
      return { key: 'prepayment.refund.walletNotFound' };
    case 'api':
      return actionErrorText('refund', failure.error);
  }
}

/**
 * What the dialog shows after a refund.
 *
 * @param outcome - The outcome of {@link executeRefund}.
 * @param formatAmount - Formats an amount.
 * @returns The severity and the message.
 */
export function refundOutcomeText(
  outcome: RefundOutcome,
  formatAmount: (amount: number) => string,
): { severity: 'success' | 'warning' | 'error'; text: Text } {
  switch (outcome.kind) {
    case 'done':
      return outcome.missingAmount > 0
        ? {
            severity: 'warning',
            text: {
              key: 'prepayment.refund.doneToRegularize',
              params: {
                fee: formatAmount(outcome.feeAmount),
                missing: formatAmount(outcome.missingAmount),
              },
            },
          }
        : { severity: 'success', text: { key: 'prepayment.refund.done' } };
    case 'fee-in-doubt':
      return { severity: 'warning', text: { key: 'prepayment.refund.feeInDoubt' } };
    case 'refund-refused':
      return { severity: 'error', text: actionErrorText('refund', outcome.error) };
    case 'refund-unknown':
      return { severity: 'warning', text: { key: 'prepayment.refund.refundUnknown' } };
    case 'fee-refused':
      return { severity: 'error', text: { key: 'prepayment.refund.feeRefused' } };
    case 'fee-unknown':
      return { severity: 'warning', text: { key: 'prepayment.refund.feeUnknown' } };
    case 'credits-failed':
      return { severity: 'error', text: { key: 'prepayment.refund.creditsFailed' } };
    case 'write-failed':
      return { severity: 'error', text: { key: 'prepayment.refund.writeFailed' } };
  }
}

type Phase =
  | { readonly kind: 'planning' }
  | { readonly kind: 'failed'; readonly text: Text }
  | { readonly kind: 'plan'; readonly plan: RefundPlan; readonly confirming: FeeDecision | 'run' | null }
  | { readonly kind: 'running' }
  | { readonly kind: 'outcome'; readonly outcome: RefundOutcome };

/**
 * The refund of a cancelled booking (or the resume of a refund stopped on the way). It reads
 * everything first (live invoice, refundable amount, policy, fees, wallet) and shows the
 * breakdown; the operator confirms, then each step is recorded as it is done. A fee call with an
 * unknown outcome is never charged again without the operator saying whether it was.
 *
 * @param props - The row and how to close.
 * @returns The dialog.
 */
export function RefundDialog({ ctx, onClose }: { readonly ctx: BookingContext; readonly onClose: () => void }) {
  const env = usePrepaymentEnv();
  const { i18n, deps, settings, formatAmount } = env;
  const bookingId = ctx.booking.id;
  const [phase, setPhase] = useState<Phase>({ kind: 'planning' });

  const plan = useCallback(async () => {
    if (!deps || !settings) return;
    setPhase({ kind: 'planning' });
    const read = await readBookingState(deps.collection, bookingId);
    if (!read.ok) {
      setPhase({ kind: 'failed', text: storageErrorText(read.error) });
      return;
    }
    const planned = await planRefund(deps, { booking: ctx.booking, doc: read.value, settings });
    setPhase(
      planned.ok
        ? { kind: 'plan', plan: planned.plan, confirming: null }
        : { kind: 'failed', text: planFailureText(planned.error) },
    );
  }, [bookingId, ctx.booking, deps, settings]);

  const blocked = env.blocker !== null || deps === null;
  useEffect(() => {
    if (!blocked) void plan();
    // Plans once when the dialog opens (and when the settings arrive).
  }, [blocked]);

  const run = async (current: RefundPlan, decision?: FeeDecision) => {
    if (!deps) return;
    setPhase({ kind: 'running' });
    const outcome = await executeRefund(deps, current, decision);
    setPhase({ kind: 'outcome', outcome });
    await env.refresh(bookingId, outcome.kind === 'done' ? outcome.doc : null);
  };

  const title = i18n.t('prepayment.refund.title');
  if (env.blocker) {
    return (
      <DialogFrame title={title} onClose={onClose} i18n={i18n}>
        <TextAlert severity="error" text={env.blocker} i18n={i18n} />
      </DialogFrame>
    );
  }
  if (phase.kind === 'planning' || phase.kind === 'running') {
    return (
      <DialogFrame title={title} onClose={onClose} busy i18n={i18n}>
        <TextAlert
          severity="info"
          text={{ key: phase.kind === 'planning' ? 'prepayment.refund.planning' : 'prepayment.refund.running' }}
          i18n={i18n}
        />
      </DialogFrame>
    );
  }
  if (phase.kind === 'failed') {
    return (
      <DialogFrame title={title} onClose={onClose} i18n={i18n}>
        <TextAlert severity="error" text={phase.text} i18n={i18n} />
      </DialogFrame>
    );
  }
  if (phase.kind === 'outcome') {
    const { severity, text } = refundOutcomeText(phase.outcome, formatAmount);
    const failure = phase.outcome.kind === 'write-failed' ? storageErrorText(phase.outcome.failure) : null;
    const resumable = phase.outcome.kind !== 'done';
    return (
      <DialogFrame
        title={title}
        onClose={onClose}
        i18n={i18n}
        actions={
          resumable ? (
            <Button onClick={() => void plan()}>{i18n.t('prepayment.refund.readAgain')}</Button>
          ) : undefined
        }
      >
        <TextAlert severity={severity} text={text} i18n={i18n} />
        {failure && <TextAlert severity="error" text={failure} i18n={i18n} />}
      </DialogFrame>
    );
  }

  const current = phase.plan;
  const lines: Text[] = [
    {
      key: POLICY_KEYS[current.policy.kind],
      params: { hours: i18n.formatNumber(Math.round(current.policy.hoursBeforeStart * 10) / 10) },
    },
    current.refund
      ? { key: 'prepayment.refund.line.refund', params: { amount: formatAmount(current.refund.amount) } }
      : { key: 'prepayment.refund.line.alreadyRefunded' },
  ];
  if (current.fee) {
    lines.push({ key: 'prepayment.refund.line.fee', params: { amount: formatAmount(current.fee.amount) } });
  }
  if (current.credits.kind === 'revoke') {
    lines.push({
      key: 'prepayment.refund.line.credits',
      params: { balance: formatAmount(current.credits.balance) },
    });
  } else if (current.credits.kind === 'skip') {
    lines.push({ key: 'prepayment.refund.line.noCredits' });
  }
  if (current.missingAmount > 0) {
    lines.push({
      key: 'prepayment.refund.line.missing',
      params: { amount: formatAmount(current.missingAmount) },
    });
  }

  const confirming = phase.confirming;
  const decide = (decision: FeeDecision) => setPhase({ kind: 'plan', plan: current, confirming: decision });
  const actions = current.feeInDoubt ? (
    confirming === 'charged' || confirming === 'not-charged' ? (
      <Button variant="contained" color="warning" onClick={() => void run(current, confirming)}>
        {i18n.t('prepayment.refund.confirmDecision')}
      </Button>
    ) : (
      <>
        <Button onClick={() => decide('charged')}>{i18n.t('prepayment.refund.feeWasCharged')}</Button>
        <Button color="warning" onClick={() => decide('not-charged')}>
          {i18n.t('prepayment.refund.feeWasNotCharged')}
        </Button>
      </>
    )
  ) : confirming === 'run' ? (
    <Button variant="contained" color="error" onClick={() => void run(current)}>
      {i18n.t('prepayment.refund.confirmButton')}
    </Button>
  ) : (
    <Button
      variant="contained"
      color="error"
      onClick={() => setPhase({ kind: 'plan', plan: current, confirming: 'run' })}
    >
      {i18n.t(current.refund ? 'prepayment.action.refund' : 'prepayment.action.resumeRefund')}
    </Button>
  );

  return (
    <DialogFrame title={title} onClose={onClose} i18n={i18n} actions={actions}>
      <List dense>
        {lines.map((line) => (
          <ListItem key={line.key} disableGutters>
            <ListItemText primary={i18n.t(line.key, line.params)} />
          </ListItem>
        ))}
      </List>
      {current.feeInDoubt && (
        <TextAlert severity="warning" text={{ key: 'prepayment.refund.feeInDoubt' }} i18n={i18n} />
      )}
      {confirming === 'not-charged' && (
        <TextAlert severity="warning" text={{ key: 'prepayment.refund.confirmNotCharged' }} i18n={i18n} />
      )}
      {confirming === 'charged' && (
        <TextAlert severity="info" text={{ key: 'prepayment.refund.confirmCharged' }} i18n={i18n} />
      )}
      {confirming === 'run' && (
        <TextAlert severity="warning" text={{ key: 'prepayment.refund.confirm' }} i18n={i18n} />
      )}
    </DialogFrame>
  );
}
