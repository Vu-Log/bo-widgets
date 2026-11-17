import type { BookingContext } from '../extensions';
import { ChargeDialog } from './dialogs/ChargeDialog';
import { NotesDialog } from './dialogs/NotesDialog';
import { RefundDialog } from './dialogs/RefundDialog';
import { RegularizeDialog, UndoRegularizationDialog } from './dialogs/RegularizeDialogs';
import { RetryDialog } from './dialogs/RetryDialog';
import { VerifyDialog } from './dialogs/VerifyDialog';
import type { PrepaymentActionId } from './rules';
import { prepaymentDialogs, useDialogRequest, type DialogStore } from './store';

type DialogComponent = (props: { readonly ctx: BookingContext; readonly onClose: () => void }) => React.ReactNode;

const DIALOGS: Readonly<Record<PrepaymentActionId, DialogComponent>> = {
  charge: ChargeDialog,
  verify: VerifyDialog,
  retry: RetryDialog,
  refund: RefundDialog,
  'resume-refund': RefundDialog,
  regularize: RegularizeDialog,
  'undo-regularization': UndoRegularizationDialog,
  notes: NotesDialog,
};

/**
 * The dialogs of the prepayment feature, rendered once at the root of the widget: it shows the
 * dialog an action of a row opened.
 *
 * @param props - The store of the dialogs ({@link prepaymentDialogs} by default).
 * @returns The open dialog, or nothing.
 */
export function PrepaymentHost({ store = prepaymentDialogs }: { readonly store?: DialogStore }) {
  const request = useDialogRequest(store);
  if (!request) return null;
  const Dialog = DIALOGS[request.action];
  // Keyed by booking and action: a new request starts a fresh dialog.
  return <Dialog key={`${request.action}:${request.ctx.booking.id}`} ctx={request.ctx} onClose={store.close} />;
}
