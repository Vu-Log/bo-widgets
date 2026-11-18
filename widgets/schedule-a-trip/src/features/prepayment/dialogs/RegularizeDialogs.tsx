import { Button, TextField } from '@mui/material';
import { useState } from 'react';
import { MAX_NOTE_LENGTH } from '../../../storage/booking-state';
import type { BookingContext } from '../../extensions';
import { storageErrorText, type Text } from '../messages';
import { markRegularized, undoRegularization } from '../regularize';
import { usePrepaymentEnv } from '../use-prepayment-env';
import { DialogFrame, TextAlert } from './DialogFrame';

type Result = { readonly severity: 'success' | 'error'; readonly text: Text } | null;

/**
 * "Mark as regularized": the fees left unpaid were settled by hand. An optional note (at most
 * `MAX_NOTE_LENGTH` characters); the cycle of the booking ends.
 *
 * @param props - The row and how to close.
 * @returns The dialog.
 */
export function RegularizeDialog({ ctx, onClose }: { readonly ctx: BookingContext; readonly onClose: () => void }) {
  const env = usePrepaymentEnv();
  const { i18n, deps, formatAmount } = env;
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const missing = ctx.state?.value.toRegularize?.missingAmount ?? null;
  const title = i18n.t('prepayment.regularize.title');

  const run = async () => {
    if (!deps) return;
    setBusy(true);
    const guarded = await env.guard('regularize', ctx.booking.id, () => markRegularized(deps, ctx.booking.id, note));
    setBusy(false);
    if (!guarded.ok) {
      setResult({ severity: 'error', text: { key: 'prepayment.error.unexpected' } });
      await env.refresh(ctx.booking.id);
      return;
    }
    const written = guarded.value;
    setResult(
      written.ok
        ? { severity: 'success', text: { key: 'prepayment.regularize.done' } }
        : { severity: 'error', text: storageErrorText(written.error) },
    );
    await env.refresh(ctx.booking.id, written.ok ? written.value : null);
  };

  if (result) {
    return (
      <DialogFrame title={title} onClose={onClose} i18n={i18n}>
        <TextAlert severity={result.severity} text={result.text} i18n={i18n} />
      </DialogFrame>
    );
  }
  return (
    <DialogFrame
      title={title}
      onClose={onClose}
      busy={busy}
      i18n={i18n}
      actions={
        <Button
          variant="contained"
          disabled={busy || deps === null || note.length > MAX_NOTE_LENGTH}
          onClick={() => void run()}
        >
          {i18n.t('prepayment.action.regularize')}
        </Button>
      }
    >
      {missing !== null && (
        <TextAlert
          severity="info"
          text={{ key: 'prepayment.regularize.amount', params: { amount: formatAmount(missing) } }}
          i18n={i18n}
        />
      )}
      {deps === null && (
        <TextAlert severity="error" text={{ key: 'prepayment.blocked.noUser' }} i18n={i18n} />
      )}
      <TextField
        label={i18n.t('prepayment.regularize.note')}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        multiline
        minRows={2}
        disabled={busy}
        error={note.length > MAX_NOTE_LENGTH}
        helperText={`${note.length} / ${MAX_NOTE_LENGTH}`}
      />
    </DialogFrame>
  );
}

/**
 * "Undo the regularization": puts the regularization back to do and removes the expiry.
 *
 * @param props - The row and how to close.
 * @returns The dialog.
 */
export function UndoRegularizationDialog({
  ctx,
  onClose,
}: {
  readonly ctx: BookingContext;
  readonly onClose: () => void;
}) {
  const env = usePrepaymentEnv();
  const { i18n, deps } = env;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const title = i18n.t('prepayment.undoRegularization.title');

  const run = async () => {
    if (!deps) return;
    setBusy(true);
    const guarded = await env.guard('undo-regularization', ctx.booking.id, () => undoRegularization(deps, ctx.booking.id));
    setBusy(false);
    if (!guarded.ok) {
      setResult({ severity: 'error', text: { key: 'prepayment.error.unexpected' } });
      await env.refresh(ctx.booking.id);
      return;
    }
    const written = guarded.value;
    setResult(
      written.ok
        ? { severity: 'success', text: { key: 'prepayment.undoRegularization.done' } }
        : { severity: 'error', text: storageErrorText(written.error) },
    );
    await env.refresh(ctx.booking.id, written.ok ? written.value : null);
  };

  return (
    <DialogFrame
      title={title}
      onClose={onClose}
      busy={busy}
      i18n={i18n}
      actions={
        result ? undefined : (
          <Button variant="contained" color="warning" disabled={busy || deps === null} onClick={() => void run()}>
            {i18n.t('prepayment.action.undoRegularization')}
          </Button>
        )
      }
    >
      <TextAlert
        severity={result?.severity ?? 'warning'}
        text={result?.text ?? { key: 'prepayment.undoRegularization.confirm' }}
        i18n={i18n}
      />
    </DialogFrame>
  );
}
