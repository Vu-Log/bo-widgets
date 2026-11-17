import { Button, List, ListItem, ListItemText } from '@mui/material';
import { useEffect, useState } from 'react';
import type { RefundKind } from '../../../domain/refund-policy';
import type { MessageKey } from '../../../i18n';
import { readBookingState } from '../../../storage/booking-state';
import type { BookingContext } from '../../extensions';
import { actionErrorText, storageErrorText, type Text } from '../messages';
import {
  executeRefund,
  planRefund,
  refundAmounts,
  type FeeDecision,
  type RefundAnswer,
  type RefundDecisions,
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
    case 'invalid-fee-price':
      return { key: 'prepayment.refund.invalidFeePrice' };
    case 'wallet-not-found':
      return { key: 'prepayment.refund.walletNotFound' };
    case 'wallet-balance-unknown':
      return { key: 'prepayment.refund.walletBalanceUnknown' };
    case 'api':
      return actionErrorText('refund', failure.error);
  }
}

/**
 * What the dialog shows after a refund: the business message, and the detail of the failure
 * (API or storage) when there is one.
 *
 * @param outcome - The outcome of {@link executeRefund}.
 * @param formatAmount - Formats an amount.
 * @returns The severity, the message and its detail.
 */
export function refundOutcomeText(
  outcome: RefundOutcome,
  formatAmount: (amount: number) => string,
): { severity: 'success' | 'warning' | 'error'; text: Text; detail: Text | null } {
  switch (outcome.kind) {
    case 'done':
      return outcome.missingAmount > 0
        ? {
            severity: 'warning',
            text: {
              key: 'prepayment.refund.doneToRegularize',
              params: { fee: formatAmount(outcome.feeAmount), missing: formatAmount(outcome.missingAmount) },
            },
            detail: null,
          }
        : { severity: 'success', text: { key: 'prepayment.refund.done' }, detail: null };
    case 'needs-decision':
      return {
        severity: 'warning',
        text: { key: outcome.tooRecent ? 'prepayment.refund.decisionTooRecent' : 'prepayment.refund.decisionNeeded' },
        detail: null,
      };
    case 'refund-refused':
      return {
        severity: 'error',
        text: actionErrorText('refund', outcome.error),
        detail: outcome.releaseFailure ? storageErrorText(outcome.releaseFailure) : null,
      };
    case 'refund-unknown':
      return { severity: 'warning', text: { key: 'prepayment.refund.refundUnknown' }, detail: actionErrorText('refund', outcome.error) };
    case 'fee-refused':
      return {
        severity: 'error',
        text: { key: 'prepayment.refund.feeRefused' },
        detail: outcome.releaseFailure ? storageErrorText(outcome.releaseFailure) : actionErrorText('refund', outcome.error),
      };
    case 'fee-unknown':
      return { severity: 'warning', text: { key: 'prepayment.refund.feeUnknown' }, detail: actionErrorText('refund', outcome.error) };
    case 'fee-charged-unrecorded':
      return {
        severity: 'error',
        text: {
          key: 'prepayment.refund.feeChargedUnrecorded',
          params: { amount: formatAmount(outcome.amount), invoiceId: outcome.invoiceId ?? '–' },
        },
        detail: storageErrorText(outcome.failure),
      };
    case 'credits-failed':
      return { severity: 'error', text: { key: 'prepayment.refund.creditsFailed' }, detail: actionErrorText('refund', outcome.error) };
    case 'write-failed':
      return { severity: 'error', text: { key: 'prepayment.refund.writeFailed' }, detail: storageErrorText(outcome.failure) };
  }
}

/**
 * The lines of the breakdown of a plan.
 *
 * @param plan - The plan.
 * @param formatAmount - Formats an amount.
 * @param formatHours - Formats the hours before the start.
 * @returns The messages, in order.
 */
export function planLines(
  plan: RefundPlan,
  formatAmount: (amount: number) => string,
  formatHours: (hours: number) => string,
): Text[] {
  const lines: Text[] = [
    { key: POLICY_KEYS[plan.policy.kind], params: { hours: formatHours(plan.policy.hoursBeforeStart) } },
  ];
  switch (plan.refund.kind) {
    case 'call':
      lines.push({ key: 'prepayment.refund.line.refund', params: { amount: formatAmount(plan.refund.amount) } });
      break;
    case 'in-doubt':
      lines.push({ key: 'prepayment.refund.line.refundInDoubt', params: { amount: formatAmount(plan.refund.call.amount) } });
      break;
    case 'record-only':
    case 'done':
      lines.push({ key: 'prepayment.refund.line.alreadyRefunded' });
      break;
  }
  if (plan.fee.kind === 'charge') {
    lines.push({ key: 'prepayment.refund.line.fee', params: { amount: formatAmount(plan.fee.amount) } });
  } else if (plan.fee.kind === 'in-doubt') {
    lines.push({ key: 'prepayment.refund.line.feeInDoubt', params: { amount: formatAmount(plan.fee.charge.amount) } });
  }
  if (plan.credits.kind === 'revoke') {
    lines.push({ key: 'prepayment.refund.line.credits', params: { balance: formatAmount(plan.credits.balance) } });
  } else if (plan.credits.kind === 'skip') {
    lines.push({ key: 'prepayment.refund.line.noCredits' });
  }
  const { missing } = refundAmounts(plan);
  if (missing > 0) {
    lines.push({ key: 'prepayment.refund.line.missing', params: { amount: formatAmount(missing) } });
  }
  return lines;
}

type Phase =
  | { readonly kind: 'planning' }
  | { readonly kind: 'failed'; readonly text: Text }
  | { readonly kind: 'plan'; readonly plan: RefundPlan; readonly decisions: RefundDecisions; readonly confirming: boolean }
  | { readonly kind: 'running' }
  | { readonly kind: 'outcome'; readonly outcome: RefundOutcome };

const UNEXPECTED: Phase = { kind: 'failed', text: { key: 'prepayment.error.unexpected' } };

/**
 * The refund of a cancelled booking (or the resume of a refund stopped on the way). It reads
 * everything first (live invoice, refundable amount, policy, fees, wallet) and shows the
 * breakdown; the operator confirms, then each step is recorded as it is done. A refund or fees
 * with an unknown outcome are never done again without the operator saying they were not.
 *
 * @param props - The row and how to close.
 * @returns The dialog.
 */
export function RefundDialog({ ctx, onClose }: { readonly ctx: BookingContext; readonly onClose: () => void }) {
  const env = usePrepaymentEnv();
  const { i18n, deps, settings, formatAmount } = env;
  const bookingId = ctx.booking.id;
  const [phase, setPhase] = useState<Phase>({ kind: 'planning' });

  const planPhase = async (): Promise<Phase> => {
    if (!deps || !settings) return UNEXPECTED;
    const read = await readBookingState(deps.collection, bookingId);
    if (!read.ok) return { kind: 'failed', text: storageErrorText(read.error) };
    const planned = await planRefund(deps, { booking: ctx.booking, doc: read.value, settings });
    if (!planned.ok) {
      if (planned.error.kind === 'api' || planned.error.kind.startsWith('wallet') || planned.error.kind === 'invalid-fee-price') {
        env.logOutcome('refund', bookingId, planned.error);
      }
      return { kind: 'failed', text: planFailureText(planned.error) };
    }
    return { kind: 'plan', plan: planned.plan, decisions: {}, confirming: false };
  };

  const plan = async () => {
    setPhase({ kind: 'planning' });
    const result = await env.guard('refund', bookingId, planPhase);
    setPhase(result.ok ? result.value : UNEXPECTED);
  };

  const blocked = env.blocker !== null || deps === null;
  useEffect(() => {
    if (!blocked) void plan();
    // Plans once when the dialog opens (and when the settings arrive).
  }, [blocked]);

  const run = async (current: RefundPlan, decisions: RefundDecisions) => {
    if (!deps) return;
    setPhase({ kind: 'running' });
    const result = await env.guard('refund', bookingId, () => executeRefund(deps, current, decisions));
    if (!result.ok) {
      setPhase(UNEXPECTED);
      await env.refresh(bookingId);
      return;
    }
    const outcome = result.value;
    if (outcome.kind !== 'done') env.logOutcome('refund', bookingId, outcome);
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
    const { severity, text, detail } = refundOutcomeText(phase.outcome, formatAmount);
    const resumable = phase.outcome.kind !== 'done';
    return (
      <DialogFrame
        title={title}
        onClose={onClose}
        i18n={i18n}
        actions={resumable ? <Button onClick={() => void plan()}>{i18n.t('prepayment.refund.readAgain')}</Button> : undefined}
      >
        <TextAlert severity={severity} text={text} i18n={i18n} />
        {detail && <TextAlert severity="info" text={detail} i18n={i18n} />}
      </DialogFrame>
    );
  }

  const current = phase.plan;
  const { decisions, confirming } = phase;
  const setDecisions = (next: RefundDecisions) => setPhase({ kind: 'plan', plan: current, decisions: next, confirming: false });
  const refundInDoubt = current.refund.kind === 'in-doubt' ? current.refund : null;
  const feeInDoubt = current.fee.kind === 'in-doubt' ? current.fee : null;
  const refundPending = refundInDoubt !== null && decisions.refund === undefined;
  const feePending = feeInDoubt !== null && decisions.fee === undefined;
  const tooRecent = (refundInDoubt !== null && !refundInDoubt.canDecide) || (feeInDoubt !== null && !feeInDoubt.canDecide);

  const answerButtons = (
    <>
      {refundPending && (
        <>
          <Button disabled={tooRecent} onClick={() => setDecisions({ ...decisions, refund: 'refunded' satisfies RefundAnswer })}>
            {i18n.t('prepayment.refund.wasRefunded')}
          </Button>
          <Button color="warning" disabled={tooRecent} onClick={() => setDecisions({ ...decisions, refund: 'not-refunded' })}>
            {i18n.t('prepayment.refund.wasNotRefunded')}
          </Button>
        </>
      )}
      {!refundPending && feePending && (
        <>
          <Button disabled={tooRecent} onClick={() => setDecisions({ ...decisions, fee: 'charged' satisfies FeeDecision })}>
            {i18n.t('prepayment.refund.feeWasCharged')}
          </Button>
          <Button color="warning" disabled={tooRecent} onClick={() => setDecisions({ ...decisions, fee: 'not-charged' })}>
            {i18n.t('prepayment.refund.feeWasNotCharged')}
          </Button>
        </>
      )}
    </>
  );
  const actions =
    refundPending || feePending ? (
      answerButtons
    ) : confirming ? (
      <Button variant="contained" color="error" onClick={() => void run(current, decisions)}>
        {i18n.t('prepayment.refund.confirmButton')}
      </Button>
    ) : (
      <Button variant="contained" color="error" onClick={() => setPhase({ ...phase, confirming: true })}>
        {i18n.t(current.refund.kind === 'call' ? 'prepayment.action.refund' : 'prepayment.action.resumeRefund')}
      </Button>
    );

  const formatHours = (hours: number) => i18n.formatNumber(Math.round(hours * 10) / 10);
  return (
    <DialogFrame title={title} onClose={onClose} i18n={i18n} actions={actions}>
      <List dense>
        {planLines(current, formatAmount, formatHours).map((line) => (
          <ListItem key={line.key} disableGutters>
            <ListItemText primary={i18n.t(line.key, line.params)} />
          </ListItem>
        ))}
      </List>
      {refundPending && <TextAlert severity="warning" text={{ key: 'prepayment.refund.refundInDoubt' }} i18n={i18n} />}
      {!refundPending && feePending && <TextAlert severity="warning" text={{ key: 'prepayment.refund.feeInDoubt' }} i18n={i18n} />}
      {(refundPending || feePending) && tooRecent && (
        <TextAlert severity="info" text={{ key: 'prepayment.refund.decisionTooRecent' }} i18n={i18n} />
      )}
      {decisions.refund === 'not-refunded' && (
        <TextAlert severity="warning" text={{ key: 'prepayment.refund.confirmNotRefunded' }} i18n={i18n} />
      )}
      {decisions.fee === 'not-charged' && (
        <TextAlert severity="warning" text={{ key: 'prepayment.refund.confirmNotCharged' }} i18n={i18n} />
      )}
      {decisions.fee === 'charged' && (
        <TextAlert severity="info" text={{ key: 'prepayment.refund.confirmCharged' }} i18n={i18n} />
      )}
      {confirming && <TextAlert severity="warning" text={{ key: 'prepayment.refund.confirm' }} i18n={i18n} />}
    </DialogFrame>
  );
}
