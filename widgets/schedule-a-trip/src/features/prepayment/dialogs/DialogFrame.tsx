import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
} from '@mui/material';
import type { ReactNode } from 'react';
import type { I18n } from '../../../i18n';
import type { Text } from '../messages';

/** Props of {@link DialogFrame}. */
export interface DialogFrameProps {
  readonly title: string;
  readonly onClose: () => void;
  /** A call is running: the dialog cannot be closed and shows a progress. */
  readonly busy?: boolean;
  /** Buttons besides "Close". */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly i18n: I18n;
}

/**
 * The frame of the dialogs of the feature: title, content, a progress while a call runs (closing
 * is refused meanwhile: a money call must not be left without its outcome) and the buttons.
 *
 * @param props - Title, content and buttons.
 * @returns The dialog.
 */
export function DialogFrame({ title, onClose, busy = false, actions, children, i18n }: DialogFrameProps) {
  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      onClose={busy ? undefined : onClose}
      aria-labelledby="prepayment-dialog-title"
    >
      <DialogTitle id="prepayment-dialog-title">{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {children}
        </Stack>
      </DialogContent>
      <DialogActions>
        {busy && <CircularProgress size={20} aria-label={i18n.t('common.loading')} />}
        <Button onClick={onClose} disabled={busy}>
          {i18n.t('prepayment.button.close')}
        </Button>
        {actions}
      </DialogActions>
    </Dialog>
  );
}

/**
 * A message of the catalogues in an alert.
 *
 * @param props - Severity, message and i18n.
 * @returns The alert.
 */
export function TextAlert({
  severity,
  text,
  i18n,
}: {
  readonly severity: 'error' | 'warning' | 'info' | 'success';
  readonly text: Text;
  readonly i18n: I18n;
}) {
  return (
    <Alert severity={severity} role={severity === 'error' ? 'alert' : 'status'}>
      {i18n.t(text.key, text.params)}
    </Alert>
  );
}
