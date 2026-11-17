import { Button, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import {
  amountWarnings,
  computeChargeAmount,
  estimateDuration,
  round2,
  type AmountWarning,
  type Duration,
} from '../../../domain/charge-amount';
import type { I18n } from '../../../i18n';
import type { BookingContext } from '../../extensions';
import { chargePrepayment, type ChargeOutcome } from '../charge';
import { actionErrorText, storageErrorText, type Text } from '../messages';
import { prepaymentEligibility, type Eligibility } from '../rules';
import { usePrepaymentEnv } from '../use-prepayment-env';
import { DialogFrame, TextAlert } from './DialogFrame';

/**
 * Reads an amount typed by an operator, with a comma or a point.
 *
 * @param text - What was typed.
 * @returns The number, `NaN` when it is not one.
 */
export const parseAmount = (text: string): number => {
  const normalized = text.trim().replace(',', '.');
  return normalized === '' ? Number.NaN : Number(normalized);
};

const durationText = (i18n: I18n, duration: Duration): string =>
  duration.days > 0
    ? i18n.t('prepayment.duration.daysHours', { days: duration.days, hours: duration.hours })
    : i18n.t('prepayment.duration.hours', { hours: duration.hours });

const ELIGIBILITY_TEXT: Record<Exclude<Eligibility['kind'], 'eligible' | 'loading'>, Text> = {
  b2b: { key: 'prepayment.charge.b2b' },
  'no-customer': { key: 'prepayment.charge.noCustomer' },
  'no-profile': { key: 'prepayment.charge.noProfile' },
  'no-entity': { key: 'prepayment.charge.noEntity' },
};

/** What the dialog shows after a charge. */
function outcomeText(outcome: ChargeOutcome): { severity: 'success' | 'warning' | 'error'; text: Text } {
  switch (outcome.kind) {
    case 'charged':
      return { severity: 'success', text: { key: 'prepayment.charge.done' } };
    case 'charged-unrecorded':
      return {
        severity: 'warning',
        text: { key: 'prepayment.charge.unrecorded', params: { invoiceId: outcome.invoiceId } },
      };
    case 'refused':
      return outcome.releaseFailure
        ? { severity: 'error', text: { key: 'prepayment.charge.refusedLocked' } }
        : { severity: 'error', text: actionErrorText('charge', outcome.error) };
    case 'to-verify':
      return { severity: 'warning', text: { key: 'prepayment.charge.toVerify' } };
    case 'not-claimed':
      return { severity: 'error', text: storageErrorText(outcome.failure) };
    case 'invalid':
      return {
        severity: 'error',
        text: {
          key: outcome.reason === 'amount' ? 'prepayment.charge.invalidAmount' : 'prepayment.charge.noCustomer',
        },
      };
  }
}

type Step =
  | { readonly kind: 'form' }
  | { readonly kind: 'confirm' }
  | { readonly kind: 'running' }
  | { readonly kind: 'outcome'; readonly outcome: ChargeOutcome };

/**
 * The prepayment dialog. With a planned return date, the amount is prefilled with the computed
 * one (shown as a reference); without, it is required and its duration is estimated as it is
 * typed. Warnings (above the computed amount, below the minimum) never block: the operator
 * confirms "Prepay anyway". Every charge is confirmed, then claimed before the invoice is created.
 *
 * @param props - The row and how to close.
 * @returns The dialog.
 */
export function ChargeDialog({ ctx, onClose }: { readonly ctx: BookingContext; readonly onClose: () => void }) {
  const env = usePrepaymentEnv();
  const { i18n, settings, formatAmount } = env;
  const [typed, setTyped] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'form' });

  const booking = ctx.booking;
  const eligibility = prepaymentEligibility(booking, ctx.customer);
  const computed = settings
    ? computeChargeAmount(
        new Date(booking.startDate),
        booking.plannedReturnDate ? new Date(booking.plannedReturnDate) : null,
        settings,
      )
    : null;
  const text = typed ?? (computed === null ? '' : String(computed));
  const amount = round2(parseAmount(text));
  const check = settings ? amountWarnings(amount, computed, settings) : { valid: false as const };
  const warnings: readonly AmountWarning[] = check.valid ? check.warnings : [];
  const duration = settings ? estimateDuration(amount, settings) : null;
  const blocked = env.blocker ?? (eligibility.kind === 'eligible' ? null : eligibility.kind === 'loading' ? { key: 'common.loading' as const } : ELIGIBILITY_TEXT[eligibility.kind]);
  const canSubmit = blocked === null && check.valid && env.deps !== null;

  const run = async () => {
    if (!env.deps || !settings || eligibility.kind !== 'eligible' || !check.valid) return;
    setStep({ kind: 'running' });
    const outcome = await chargePrepayment(env.deps, {
      booking,
      entityId: eligibility.entityId,
      amount,
      computedAmount: computed,
      warnings,
      productId: settings.prepaymentProductId,
      settings,
    });
    setStep({ kind: 'outcome', outcome });
    await env.refresh(booking.id, outcome.kind === 'charged' ? outcome.doc : null);
  };

  const warningTexts = warnings.map((warning): Text =>
    warning === 'above-computed'
      ? {
          key: 'prepayment.warning.aboveComputed',
          params: {
            computed: formatAmount(computed ?? 0),
            ratio: settings?.ratio ?? 0,
            difference: formatAmount(round2(amount - (computed ?? 0))),
          },
        }
      : {
          key: 'prepayment.warning.belowMinimum',
          params: { minimum: formatAmount(settings?.minimumAmount ?? 0) },
        },
  );

  if (step.kind === 'outcome') {
    const { severity, text: message } = outcomeText(step.outcome);
    return (
      <DialogFrame title={i18n.t('prepayment.charge.title')} onClose={onClose} i18n={i18n}>
        <TextAlert severity={severity} text={message} i18n={i18n} />
      </DialogFrame>
    );
  }

  const confirming = step.kind === 'confirm' || step.kind === 'running';
  return (
    <DialogFrame
      title={i18n.t('prepayment.charge.title')}
      onClose={onClose}
      busy={step.kind === 'running'}
      i18n={i18n}
      actions={
        confirming ? (
          <>
            <Button onClick={() => setStep({ kind: 'form' })} disabled={step.kind === 'running'}>
              {i18n.t('prepayment.button.back')}
            </Button>
            <Button
              variant="contained"
              color={warnings.length > 0 ? 'warning' : 'primary'}
              onClick={() => void run()}
              disabled={step.kind === 'running' || !canSubmit}
            >
              {i18n.t('prepayment.charge.confirmButton', { amount: formatAmount(amount) })}
            </Button>
          </>
        ) : (
          <Button
            variant="contained"
            color={warnings.length > 0 ? 'warning' : 'primary'}
            disabled={!canSubmit}
            onClick={() => setStep({ kind: 'confirm' })}
          >
            {warnings.length > 0 ? i18n.t('prepayment.charge.anyway') : i18n.t('prepayment.charge.submit')}
          </Button>
        )
      }
    >
      {blocked && <TextAlert severity={eligibility.kind === 'b2b' ? 'info' : 'error'} text={blocked} i18n={i18n} />}
      {computed !== null && settings && (
        <Typography variant="body2" color="text.secondary">
          {i18n.t('prepayment.charge.computed', {
            amount: formatAmount(computed),
            duration: durationText(i18n, estimateDuration(computed, settings) ?? { days: 0, hours: 0, totalHours: 0 }),
          })}
        </Typography>
      )}
      {computed === null && settings && (
        <Typography variant="body2" color="text.secondary">
          {i18n.t('prepayment.charge.noReturnDate')}
        </Typography>
      )}
      <TextField
        label={i18n.t('prepayment.charge.amount')}
        value={text}
        onChange={(event) => setTyped(event.target.value)}
        required
        disabled={confirming || blocked !== null}
        inputMode="decimal"
        error={text !== '' && !check.valid}
        helperText={
          text !== '' && !check.valid
            ? i18n.t('prepayment.charge.invalidAmount')
            : duration
              ? i18n.t('prepayment.charge.estimate', { duration: durationText(i18n, duration) })
              : ' '
        }
        slotProps={{ htmlInput: { 'aria-label': i18n.t('prepayment.charge.amount') } }}
      />
      {warningTexts.map((warning) => (
        <TextAlert key={warning.key} severity="warning" text={warning} i18n={i18n} />
      ))}
      {confirming && (
        <TextAlert
          severity="info"
          text={{ key: 'prepayment.charge.confirm', params: { amount: formatAmount(amount) } }}
          i18n={i18n}
        />
      )}
    </DialogFrame>
  );
}
