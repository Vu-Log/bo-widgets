import type { BookingContext } from '../extensions';
import { lazyModule, type LazyComponent } from '../../ui/lazy';
import { LazyDialogBoundary } from '../../ui/LazyBoundary';
import type { PrepaymentActionId } from './rules';
import { prepaymentDialogs, useDialogRequest, type DialogStore } from './store';

type DialogProps = { readonly ctx: BookingContext; readonly onClose: () => void };

// Every dialog of the feature is in one chunk (`./dialogs/index.ts`), loaded on first use.
const dialogs = lazyModule('prepayment-dialogs', () => import('./dialogs'));
const RefundDialog = dialogs.component((module) => module.RefundDialog);

const DIALOGS: Readonly<Record<PrepaymentActionId, LazyComponent<DialogProps>>> = {
  charge: dialogs.component((module) => module.ChargeDialog),
  verify: dialogs.component((module) => module.VerifyDialog),
  retry: dialogs.component((module) => module.RetryDialog),
  refund: RefundDialog,
  'resume-refund': RefundDialog,
  regularize: dialogs.component((module) => module.RegularizeDialog),
  'undo-regularization': dialogs.component((module) => module.UndoRegularizationDialog),
  notes: dialogs.component((module) => module.NotesDialog),
};

/**
 * Loads the chunk of the dialogs ahead of time (idle time after the first render). Never rejects.
 *
 * @returns Settles when it is loaded or failed.
 */
export const preloadPrepaymentDialogs = (): Promise<void> => dialogs.preload();

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
  return (
    <LazyDialogBoundary key={`${request.action}:${request.ctx.booking.id}`} onClose={store.close}>
      <Dialog ctx={request.ctx} onClose={store.close} />
    </LazyDialogBoundary>
  );
}
