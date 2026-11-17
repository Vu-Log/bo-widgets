import { Box, Button } from '@mui/material';
import type { ReactNode } from 'react';
import { storedDataStatus } from '../../domain/archive';
import type { MessageKey, MessageParams } from '../../i18n';
import { DetailCardFrame } from '../core/cards';
import type { BookingAction, BookingContext, BookingFeature } from '../extensions';
import { CreateBookingDialog } from './CreateBooking';
import { ConfirmDialog, EditModelDialog, EditTripDialog } from './dialogs';
import { useOpenDialog, type DialogStore, type WriteDialog } from './store';
import { VehiclePickerDialog } from './VehiclePicker';

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
 * The write actions a booking allows, in the order of the menu, as the back office allows them:
 * edit the trip and the model while it is to come (the model without a vehicle), allocate without a
 * vehicle, take the vehicle back, pre-allocate or remove the pre-allocation, cancel before the start.
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
      run: open('preallocate'),
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
          <Button
            key={action.id}
            size="small"
            variant="outlined"
            color={action.tone === 'danger' ? 'error' : 'primary'}
            disabled={action.disabled}
            onClick={() => action.run(ctx)}
          >
            {action.label}
          </Button>
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
  const close = store.close;
  switch (dialog.kind) {
    case 'create':
      return <CreateBookingDialog onClose={close} />;
    case 'edit-trip':
      return <EditTripDialog ctx={dialog.ctx} onClose={close} />;
    case 'edit-model':
      return <EditModelDialog ctx={dialog.ctx} onClose={close} />;
    case 'allocate':
    case 'preallocate':
      return <VehiclePickerDialog mode={dialog.kind} ctx={dialog.ctx} onClose={close} />;
    case 'cancel':
    case 'deallocate':
    case 'remove-preallocation':
      return <ConfirmDialog kind={dialog.kind} ctx={dialog.ctx} onClose={close} />;
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
      return action ? { ...action, tone: 'primary' } : null;
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
