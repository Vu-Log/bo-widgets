import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@vulog/bo-widget-react';
import { useState, type ReactNode } from 'react';
import { ApiRequestError, type ApiResult } from '../../api/http';
import { deallocateVehicle, updateBookingRequest, type BookingRequestChanges } from '../../api/schedule-a-trip';
import { datesProblems } from '../../domain/booking-dates';
import { useI18n } from '../../i18n';
import { modelsQueryOptions } from '../../query/queries';
import { queryErrorText } from '../core/common';
import type { BookingContext } from '../extensions';
import { useSection } from '../section-context';
import { cancel, removePreallocation, type OperationResult } from './operations';
import { DateFields, PickupFields, toPickup, type DatesValue, type PickupValue } from './fields';
import { failureText, useAfterWrite, useReportFailure, useWriteDeps } from './use-write';

import { MAX_NOTES_LENGTH } from '../../domain/new-booking';

/** Props of {@link WriteDialogFrame}. */
export interface WriteDialogFrameProps {
  readonly title: string;
  readonly onClose: () => void;
  /** Without it, the dialog only has a Close button (its fields act themselves). */
  readonly onSubmit?: () => void;
  readonly submitLabel?: string;
  readonly submitting: boolean;
  /** The failure of the last try, shown above the buttons. */
  readonly error: string | null;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  readonly wide?: boolean;
  readonly children: ReactNode;
}

/**
 * A dialog of a write: its fields, the failure of the last try, and Cancel / submit buttons. It
 * cannot be closed while the write runs.
 *
 * @param props - Title, fields, state and handlers.
 * @returns The dialog.
 */
export function WriteDialogFrame(props: WriteDialogFrameProps) {
  const { t } = useI18n();
  return (
    <Dialog
      open
      onClose={props.submitting ? undefined : props.onClose}
      fullWidth
      maxWidth={props.wide ? 'lg' : 'sm'}
      aria-labelledby="write-dialog-title"
    >
      <DialogTitle id="write-dialog-title">{props.title}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
        {props.children}
        {props.error && (
          <Alert severity="error" role="alert">
            {props.error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose} disabled={props.submitting}>
          {props.onSubmit ? t('form.cancel') : t('detail.close')}
        </Button>
        {props.onSubmit && (
          <Button
            variant="contained"
            color={props.danger ? 'error' : 'primary'}
            onClick={props.onSubmit}
            disabled={props.submitting || props.disabled}
          >
            {props.submitLabel}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** The message of a failed mutation: an API failure, an operation failure, or a thrown error. */
function mutationErrorText(error: unknown, t: ReturnType<typeof useI18n>['t']): string {
  if (error instanceof OperationError) return failureText(error.result.failure, t);
  if (error instanceof Error) return queryErrorText(error, t);
  return t('common.unexpectedError');
}

/** An operation that failed, thrown so that `useMutation` reports it. */
export class OperationError extends Error {
  constructor(readonly result: Extract<OperationResult, { ok: false }>) {
    super(`Operation failed: ${result.failure.kind}`);
    this.name = 'OperationError';
  }
}

const unwrapApi = (result: ApiResult<null>) => {
  if (!result.ok) throw new ApiRequestError(result.error);
};

/**
 * A booking changed with the routes of the back office (dates, notes, pickup point, model): sends the
 * fields changed, then reads the booking again.
 */
function useUpdate(ctx: BookingContext, successKey: 'write.updated', onDone: () => void) {
  const { t } = useI18n();
  const authFetch = useAuthFetch();
  const { fleetId } = useSection();
  const after = useAfterWrite();
  const mutation = useMutation({
    mutationFn: async (input: { modelId: number | null; changes: BookingRequestChanges }) =>
      unwrapApi(await updateBookingRequest(authFetch, fleetId, ctx.booking.id, input.modelId, input.changes)),
    onSuccess: () => {
      after(t(successKey), ctx.booking.id, undefined, [], t);
      onDone();
    },
  });
  return { mutation, error: mutation.error ? mutationErrorText(mutation.error, t) : null };
}

/**
 * Changes the dates, the notes and the pickup point of a booking. Only the fields changed are sent;
 * the dates are typed in the time zone of the fleet.
 *
 * @param props - The booking and the closing handler.
 * @returns The dialog.
 */
export function EditTripDialog({ ctx, onClose }: { readonly ctx: BookingContext; readonly onClose: () => void }) {
  const { t } = useI18n();
  const { booking } = ctx;
  const [dates, setDates] = useState<DatesValue>({
    start: new Date(booking.startDate),
    plannedReturn: booking.plannedReturnDate ? new Date(booking.plannedReturnDate) : null,
  });
  const [notes, setNotes] = useState(booking.notes ?? '');
  const [initialRadius] = useState(booking.radius ?? 500);
  const [pickup, setPickup] = useState<PickupValue>({
    latitude: booking.latitude,
    longitude: booking.longitude,
    radius: initialRadius,
  });
  const { mutation, error } = useUpdate(ctx, 'write.updated', onClose);

  const startChanged = dates.start?.getTime() !== Date.parse(booking.startDate);
  const complete = toPickup(pickup);
  const pickupChanged =
    pickup.latitude !== booking.latitude || pickup.longitude !== booking.longitude || pickup.radius !== initialRadius;
  const problems = datesProblems({ start: dates.start, plannedReturn: dates.plannedReturn, now: new Date() })
    // An unchanged start may be past already: only a new start must be in the future.
    .filter((problem) => problem !== 'start-past' || startChanged);
  const changes: BookingRequestChanges = {
    ...(startChanged && dates.start ? { start: dates.start } : {}),
    ...((dates.plannedReturn?.getTime() ?? null) !==
    (booking.plannedReturnDate ? Date.parse(booking.plannedReturnDate) : null)
      ? { plannedReturn: dates.plannedReturn }
      : {}),
    ...(notes !== (booking.notes ?? '') ? { notes } : {}),
    ...(pickupChanged && complete ? { pickup: complete } : {}),
  };
  const valid = problems.length === 0 && complete !== null && notes.length <= MAX_NOTES_LENGTH;
  return (
    <WriteDialogFrame
      title={t('write.editTrip')}
      onClose={onClose}
      onSubmit={() => mutation.mutate({ modelId: booking.modelId, changes })}
      submitLabel={t('form.save')}
      submitting={mutation.isPending}
      error={error}
      disabled={!valid || Object.keys(changes).length === 0}
    >
      <DateFields
        value={dates}
        onChange={setDates}
        errors={{
          start: problems.includes('start-missing')
            ? t('form.startMissing')
            : problems.includes('start-past')
              ? t('form.startPast')
              : undefined,
          plannedReturn: problems.includes('return-before-start') ? t('form.returnBeforeStart') : undefined,
        }}
      />
      <PickupFields value={pickup} onChange={setPickup} />
      <TextField
        label={t('trip.customerNotes')}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        multiline
        minRows={2}
        error={notes.length > MAX_NOTES_LENGTH}
        helperText={`${notes.length}/${MAX_NOTES_LENGTH}`}
      />
    </WriteDialogFrame>
  );
}

/**
 * Changes the model asked for by a booking, or "any model".
 *
 * @param props - The booking and the closing handler.
 * @returns The dialog.
 */
export function EditModelDialog({ ctx, onClose }: { readonly ctx: BookingContext; readonly onClose: () => void }) {
  const { t } = useI18n();
  const authFetch = useAuthFetch();
  const { fleetId } = useSection();
  const models = useQuery(modelsQueryOptions(authFetch, fleetId));
  const [modelId, setModelId] = useState<number | null>(ctx.booking.modelId);
  const { mutation, error } = useUpdate(ctx, 'write.updated', onClose);
  return (
    <WriteDialogFrame
      title={t('write.editModel')}
      onClose={onClose}
      onSubmit={() => mutation.mutate({ modelId, changes: {} })}
      submitLabel={t('form.save')}
      submitting={mutation.isPending}
      error={error ?? (models.isError ? queryErrorText(models.error, t) : null)}
      disabled={modelId === ctx.booking.modelId}
    >
      <TextField
        select
        label={t('vehicle.model')}
        value={modelId === null ? 'any' : String(modelId)}
        onChange={(event) => setModelId(event.target.value === 'any' ? null : Number(event.target.value))}
      >
        <MenuItem value="any">{t('vehicle.anyModel')}</MenuItem>
        {(models.data ?? []).map((model) => (
          <MenuItem key={model.id} value={String(model.id)}>
            {model.name}
          </MenuItem>
        ))}
        {modelId !== null && !models.data?.some((model) => model.id === modelId) && (
          <MenuItem value={String(modelId)}>{`#${modelId}`}</MenuItem>
        )}
      </TextField>
    </WriteDialogFrame>
  );
}

/** What {@link ConfirmDialog} does. */
export type ConfirmKind = 'cancel' | 'deallocate' | 'remove-preallocation';

const CONFIRM_TEXTS = {
  cancel: { title: 'write.cancelTitle', body: 'write.cancelBody', submit: 'write.cancelSubmit', done: 'write.cancelled' },
  deallocate: {
    title: 'write.deallocateTitle',
    body: 'write.deallocateBody',
    submit: 'write.deallocateSubmit',
    done: 'write.deallocated',
  },
  'remove-preallocation': {
    title: 'write.removePreallocationTitle',
    body: 'write.removePreallocationBody',
    submit: 'write.removePreallocationSubmit',
    done: 'write.preallocationRemoved',
  },
} as const satisfies Record<ConfirmKind, Record<string, string>>;

/**
 * Confirms then runs an action that cannot be undone from the widget: cancel a booking (and free its
 * pre-allocated vehicle), take its vehicle back, or remove its pre-allocation.
 *
 * @param props - The action, the booking and the closing handler.
 * @returns The dialog.
 */
export function ConfirmDialog({
  kind,
  ctx,
  onClose,
}: {
  readonly kind: ConfirmKind;
  readonly ctx: BookingContext;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const deps = useWriteDeps();
  const after = useAfterWrite();
  const report = useReportFailure();
  const texts = CONFIRM_TEXTS[kind];
  const mutation = useMutation({
    mutationFn: async (): Promise<Extract<OperationResult, { ok: true }>> => {
      if (kind === 'deallocate') {
        const { vehicleId } = ctx.booking;
        if (vehicleId === null) throw new Error('The booking has no vehicle to take back');
        const result = await deallocateVehicle(deps.authFetch, deps.fleetId, ctx.booking.id, vehicleId);
        if (!result.ok) throw new OperationError({ ok: false, failure: { kind: 'api', error: result.error } });
        return { ok: true, state: undefined, warnings: [] };
      }
      const result = kind === 'cancel' ? await cancel(deps, ctx.booking.id) : await removePreallocation(deps, ctx.booking.id);
      if (!result.ok) throw new OperationError(result);
      return result;
    },
    onSuccess: (result) => {
      after(t(texts.done), ctx.booking.id, result.state, result.warnings, t);
      onClose();
    },
    onError: (error) => {
      if (error instanceof OperationError) report(error.result.failure, ctx.booking.id);
    },
  });
  return (
    <WriteDialogFrame
      title={t(texts.title)}
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      submitLabel={t(texts.submit)}
      submitting={mutation.isPending}
      error={mutation.error ? mutationErrorText(mutation.error, t) : null}
      danger={kind !== 'remove-preallocation'}
    >
      {t(texts.body)}
    </WriteDialogFrame>
  );
}

