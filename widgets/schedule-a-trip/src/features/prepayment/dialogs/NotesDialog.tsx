import { Button, TextField } from '@mui/material';
import { useState } from 'react';
import { MAX_NOTE_LENGTH } from '../../../storage/booking-state';
import type { BookingContext } from '../../extensions';
import { storageErrorText, type Text } from '../messages';
import { saveInternalNotes } from '../notes';
import { usePrepaymentEnv } from '../use-prepayment-env';
import { DialogFrame, TextAlert } from './DialogFrame';

/**
 * The internal notes of a booking (at most `MAX_NOTE_LENGTH` characters), kept in its document and
 * seen only in the back office.
 *
 * @param props - The row and how to close.
 * @returns The dialog.
 */
export function NotesDialog({ ctx, onClose }: { readonly ctx: BookingContext; readonly onClose: () => void }) {
  const env = usePrepaymentEnv();
  const { i18n, deps } = env;
  const [notes, setNotes] = useState(ctx.state?.value.internalNotes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Text | null>(null);
  const tooLong = notes.length > MAX_NOTE_LENGTH;

  const save = async () => {
    if (!deps) return;
    setBusy(true);
    setError(null);
    const guarded = await env.guard('notes', ctx.booking.id, () =>
      saveInternalNotes(deps, ctx.booking.id, notes, ctx.state ? (ctx.state.value.internalNotes ?? '') : null),
    );
    setBusy(false);
    if (!guarded.ok) {
      setError({ key: 'prepayment.error.unexpected' });
      await env.refresh(ctx.booking.id);
      return;
    }
    const written = guarded.value;
    await env.refresh(ctx.booking.id, written.ok ? written.value : null);
    if (written.ok) onClose();
    else setError(storageErrorText(written.error));
  };

  return (
    <DialogFrame
      title={i18n.t('prepayment.notes.title')}
      onClose={onClose}
      busy={busy}
      i18n={i18n}
      actions={
        <Button variant="contained" disabled={busy || tooLong || deps === null} onClick={() => void save()}>
          {i18n.t('prepayment.button.save')}
        </Button>
      }
    >
      {deps === null && (
        <TextAlert severity="error" text={{ key: 'prepayment.blocked.noUser' }} i18n={i18n} />
      )}
      {error && <TextAlert severity="error" text={error} i18n={i18n} />}
      <TextField
        label={i18n.t('prepayment.notes.label')}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        multiline
        minRows={3}
        disabled={busy}
        error={tooLong}
        helperText={`${notes.length} / ${MAX_NOTE_LENGTH}`}
      />
    </DialogFrame>
  );
}
