import { Box, Button } from '@mui/material';
import type { ReactNode } from 'react';
import { storedDataStatus } from '../../domain/archive';
import { preallocationPrepayment } from '../../domain/preallocation';
import type { MessageKey, MessageParams } from '../../i18n';
import { DetailCardFrame } from '../core/common';
import { isActionDisabled, WithDisabledReason } from '../list/ActionReason';
import type { BookingAction, BookingContext, BookingFeature } from '../extensions';
import { lazyComponent, lazyModule } from '../../ui/lazy';
import { LazyDialogBoundary } from '../../ui/LazyBoundary';
import { useOpenDialog, type DialogStore, type WriteDialog } from './store';

// The dialogs of the writes are loaded on first use: the wizard, the edit and confirm dialogs, and
// the vehicle picker (with the map), one chunk each.
const CreateBookingDialog = lazyComponent('create-booking', () =>
  import('./CreateBooking').then((module) => module.CreateBookingDialog),
);
const editDialogs = lazyModule('write-dialogs', () => import('./dialogs'));
const EditTripDialog = editDialogs.component((module) => module.EditTripDialog);
const EditModelDialog = editDialogs.component((module) => module.EditModelDialog);
const ConfirmDialog = editDialogs.component((module) => module.ConfirmDialog);
const VehiclePickerDialog = lazyComponent('vehicle-picker', () =>
  import('./VehiclePicker').then((module) => module.VehiclePickerDialog),
);

/** What the write feature needs from the section. */
export interface WriteFeatureDeps {
  readonly t: (key: MessageKey, params?: MessageParams) => string;
  readonly store: DialogStore;
  readonly now: () => Date;
  /**
   * The host of the dialogs, built once per store: a new component on each new feature (a change
   * of language) would remount the dialog open and lose what was typed.
   */
  readonly Host: () => ReactNode;
}

/**
 * The host of the dialogs of a store, as a component of its own.
 *
 * @param store - The store.
 * @returns The component.
 */
export const hostOf = (store: DialogStore) =>
  function WriteDialogs() {
    return <WriteHost store={store} />;
  };

const upcoming = (ctx: BookingContext) => ctx.tab === 'upcoming' || ctx.tab === 'alert';

/** Whether the start of a booking is still to come. */
const notStarted = (ctx: BookingContext, now: Date) => Date.parse(ctx.booking.startDate) > now.getTime();

/**
 * Whether the widget may change the pre-allocation of a booking: still to come, without a vehicle
 * allocated, its stored state read, not handled by the scheduler yet, and not archived.
 *
 * @param ctx - The booking.
 * @param now - The current time.
 * @returns `true` when allowed.
 */
export function canPreallocate(ctx: BookingContext, now: Date): boolean {
  return (
    upcoming(ctx) &&
    ctx.booking.vehicleId === null &&
    ctx.state !== undefined &&
    ctx.state?.value.allocationProcessed !== true &&
    storedDataStatus(ctx.booking, ctx.state, now) !== 'archived'
  );
}

/**
 * Why a vehicle cannot be pre-allocated yet for its prepayment ({@link preallocationPrepayment}):
 * setting or changing a pre-allocation needs a paid prepayment or a business booking. Removing one
 * never does, so that a vehicle is always given back.
 *
 * @param ctx - The booking.
 * @param t - Translation.
 * @returns The fields of a disabled action, none when allowed.
 */
function preallocationBlock(ctx: BookingContext, t: WriteFeatureDeps['t']): Partial<BookingAction> {
  const verdict = preallocationPrepayment({
    state: ctx.state === undefined ? undefined : (ctx.state?.value ?? null),
    customer: ctx.customer,
    profileId: ctx.booking.profileId,
  });
  if (verdict === 'allowed') return {};
  return {
    disabled: true,
    disabledReason: verdict === 'loading' ? t('common.loading') : t('write.preallocateNeedsPayment'),
  };
}

/**
 * The write actions a booking allows, in the order of the menu, as the back office allows them:
 * edit the trip and the model while it is to come (the model without a vehicle), allocate without a
 * vehicle, take the vehicle back, pre-allocate or remove the pre-allocation, cancel before the start.
 * Pre-allocating waits for a paid prepayment or a business booking (disabled, with the reason).
 *
 * @param ctx - The booking.
 * @param deps - Translation, dialogs and clock.
 * @returns The actions.
 */
export function writeActions(ctx: BookingContext, deps: WriteFeatureDeps): BookingAction[] {
  const { t, store } = deps;
  const now = deps.now();
  const open = (kind: Exclude<WriteDialog['kind'], 'create'>) => (target: BookingContext) =>
    store.open({ kind, ctx: target });
  const preallocated = Boolean(ctx.state?.value.preallocatedVehicleId);
  const actions: (BookingAction | false)[] = [
    upcoming(ctx) && { id: 'edit-trip', label: t('write.editTrip'), run: open('edit-trip') },
    upcoming(ctx) && ctx.booking.vehicleId === null && { id: 'edit-model', label: t('write.editModel'), run: open('edit-model') },
    ctx.booking.vehicleId === null &&
      upcoming(ctx) && { id: 'allocate', label: t('write.allocate'), run: open('allocate') },
    ctx.booking.vehicleId !== null &&
      (upcoming(ctx) || ctx.tab === 'ongoing') && { id: 'deallocate', label: t('write.deallocate'), run: open('deallocate') },
    canPreallocate(ctx, now) && {
      id: 'preallocate',
      label: preallocated ? t('write.changePreallocation') : t('write.preallocate'),
      shortLabel: preallocated ? t('write.changePreallocationShort') : t('write.preallocateShort'),
      run: open('preallocate'),
      ...preallocationBlock(ctx, t),
    },
    canPreallocate(ctx, now) &&
      preallocated && { id: 'remove-preallocation', label: t('write.removePreallocation'), run: open('remove-preallocation') },
    upcoming(ctx) &&
      notStarted(ctx, now) && { id: 'cancel', label: t('write.cancel'), run: open('cancel'), tone: 'danger' },
  ];
  return actions.filter((action): action is BookingAction => action !== false);
}

/**
 * The write actions of a booking in its detail, as buttons.
 *
 * @param props - The booking and its actions.
 * @returns The card, nothing without action.
 */
function ActionsCard({ ctx, actions, title }: { readonly ctx: BookingContext; readonly actions: readonly BookingAction[]; readonly title: string }) {
  if (actions.length === 0) return null;
  return (
    <DetailCardFrame title={title}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {actions.map((action) => (
          <WithDisabledReason key={action.id} action={action}>
            <Button
              size="small"
              variant="outlined"
              color={action.tone === 'danger' ? 'error' : 'primary'}
              disabled={isActionDisabled(action)}
              onClick={() => action.run(ctx)}
            >
              {action.label}
            </Button>
          </WithDisabledReason>
        ))}
      </Box>
    </DetailCardFrame>
  );
}

/**
 * Renders the dialog open in a store.
 *
 * @param props - The store.
 * @returns The dialog, nothing when none is open.
 */
export function WriteHost({ store }: { readonly store: DialogStore }) {
  const dialog = useOpenDialog(store);
  if (dialog === null) return null;
  return (
    <LazyDialogBoundary key={dialogKey(dialog)} onClose={store.close}>
      <OpenDialog dialog={dialog} onClose={store.close} />
    </LazyDialogBoundary>
  );
}

/** A new dialog starts with a fresh boundary: the failure of another one is not kept. */
const dialogKey = (dialog: WriteDialog): string =>
  dialog.kind === 'create' ? 'create' : `${dialog.kind}:${dialog.ctx.booking.id}`;

/** The dialog of a request. */
function OpenDialog({ dialog, onClose }: { readonly dialog: WriteDialog; readonly onClose: () => void }) {
  switch (dialog.kind) {
    case 'create':
      return <CreateBookingDialog onClose={onClose} />;
    case 'edit-trip':
      return <EditTripDialog ctx={dialog.ctx} onClose={onClose} />;
    case 'edit-model':
      return <EditModelDialog ctx={dialog.ctx} onClose={onClose} />;
    case 'allocate':
    case 'preallocate':
      return <VehiclePickerDialog mode={dialog.kind} ctx={dialog.ctx} onClose={onClose} />;
    case 'cancel':
    case 'deallocate':
    case 'remove-preallocation':
      return <ConfirmDialog kind={dialog.kind} ctx={dialog.ctx} onClose={onClose} />;
  }
}

/**
 * The write feature of the booking section: the primary action of a booking without vehicle
 * ("Pre-allocate" when to come, "Allocate" in alert), the edit, allocation, pre-allocation and
 * cancel actions in the menu and in an Actions card of the detail (first), and their dialogs.
 *
 * @param deps - Translation, dialog store and clock.
 * @returns The feature.
 */
export function createWriteFeature(deps: WriteFeatureDeps): BookingFeature {
  const { t } = deps;
  return {
    id: 'write',
    primaryAction: (ctx) => {
      if (ctx.booking.vehicleId !== null || ctx.state?.value.preallocatedVehicleId) return null;
      const actions = writeActions(ctx, deps);
      const id = ctx.tab === 'alert' ? 'allocate' : 'preallocate';
      const action = actions.find((candidate) => candidate.id === id);
      // A pre-allocation waiting for its prepayment stays in the menu, with its reason.
      return action && !isActionDisabled(action) ? { ...action, tone: 'primary' } : null;
    },
    menuActions: (ctx) => writeActions(ctx, deps),
    detailCards: [
      {
        id: 'write-actions',
        order: 5,
        render: (ctx) => <ActionsCard ctx={ctx} actions={writeActions(ctx, deps)} title={t('write.actions')} />,
      },
    ],
    Host: deps.Host,
  };
}
