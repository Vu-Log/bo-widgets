import { useQueryClient } from '@tanstack/react-query';
import { useAuthFetch, useBoClient, useCurrentUser } from '@vulog/bo-widget-react';
import { useCallback, useMemo } from 'react';
import { ApiRequestError, apiErrorText } from '../../api/http';
import type { MessageKey, MessageParams } from '../../i18n';
import { queryKeys } from '../../query/keys';
import { liveVehiclesQueryOptions } from '../../query/queries';
import { bookingsCollection, type BookingStateDoc } from '../../storage/booking-state';
import { describeError } from '../../query/WidgetQueryProvider';
import { useSection } from '../section-context';
import type { OperationFailure, OperationWarning, WriteDeps } from './operations';

type Translate = (key: MessageKey, params?: MessageParams) => string;

/**
 * What to tell the operator about a failed operation.
 *
 * @param failure - The failure.
 * @param t - `useI18n().t`.
 * @returns A sentence.
 */
export function failureText(failure: OperationFailure, t: Translate): string {
  switch (failure.kind) {
    case 'api': {
      const { key, params } = apiErrorText(failure.error);
      return t(key, params);
    }
    case 'storage':
      return failure.error.kind === 'conflict'
        ? t('write.conflict')
        : t('write.storageFailed', { reason: failure.error.kind });
    case 'already-processed':
      return t('write.alreadyProcessed');
    case 'rollback-failed':
      return t('write.rollbackFailed', { vehicle: failure.vehicleId });
    case 'vehicle-unavailable':
      return t('write.vehicleUnavailable', { vehicle: failure.vehicleId });
    case 'allocation-unknown':
      return t('write.allocationUnknown', { vehicle: failure.vehicleId });
  }
}

/** What a log keeps of a failure or a warning: its kind, its vehicle, the kind of its error. */
export function describeOutcome(outcome: OperationFailure | OperationWarning): Record<string, string> {
  const details: Record<string, string> = { kind: outcome.kind };
  if ('vehicleId' in outcome) details.vehicleId = outcome.vehicleId;
  if ('error' in outcome) details.error = outcome.error.kind;
  if ('cause' in outcome) details.cause = outcome.cause.kind;
  return details;
}

/**
 * What to tell the operator about something left to check after an operation.
 *
 * @param warning - The warning.
 * @param t - `useI18n().t`.
 * @returns A sentence.
 */
export function warningText(warning: OperationWarning, t: Translate): string {
  switch (warning.kind) {
    case 'vehicle-not-enabled':
      return t('write.vehicleNotEnabled', { vehicle: warning.vehicleId });
    case 'vehicle-held-elsewhere':
      return t('write.vehicleHeldElsewhere', { vehicle: warning.vehicleId });
    case 'vehicle-not-checked':
      return t('write.vehicleNotChecked', { vehicle: warning.vehicleId });
    case 'state-not-updated':
      return t('write.stateNotUpdated');
  }
}

/**
 * The dependencies of the write operations for the current fleet and operator. The reason a
 * vehicle is out of service is read again from the fleet manager each time.
 *
 * @returns The dependencies.
 */
export function useWriteDeps(): WriteDeps {
  const authFetch = useAuthFetch();
  const bo = useBoClient();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const { fleetId } = useSection();
  return useMemo(
    () => ({
      authFetch,
      collection: bookingsCollection(bo.storage),
      fleetId,
      userId: user.id,
      now: () => new Date(),
      reasonOf: async (vehicleId: string) => {
        try {
          const vehicles = await queryClient.fetchQuery({
            ...liveVehiclesQueryOptions(authFetch, fleetId),
            staleTime: 0,
          });
          const vehicle = vehicles.find((candidate) => candidate.id === vehicleId);
          return {
            ok: true,
            data: vehicle ? { found: true, reason: vehicle.outOfServiceReason } : { found: false },
          } as const;
        } catch (error) {
          if (error instanceof ApiRequestError) return { ok: false, error: error.error } as const;
          throw error;
        }
      },
    }),
    [authFetch, bo, user.id, queryClient, fleetId],
  );
}

/**
 * What to do once a write succeeded: keep the stored state written, read the bookings, the trips
 * and the vehicles again, and tell the operator (with what is left to check).
 *
 * @returns `done(message, bookingId, state, warnings)`.
 */
export function useAfterWrite(): (
  message: string,
  bookingId: string | null,
  state: BookingStateDoc | null | undefined,
  warnings: readonly OperationWarning[],
  t: Translate,
) => void {
  const queryClient = useQueryClient();
  const bo = useBoClient();
  const { fleetId } = useSection();
  return useCallback(
    (message, bookingId, state, warnings, t) => {
      if (bookingId !== null && state !== undefined) {
        queryClient.setQueryData(queryKeys.bookingState(fleetId, bookingId), state);
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.fleetBookings(fleetId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tripsInProgress(fleetId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.liveVehicles(fleetId) });
      const notify = (text: string, severity: 'success' | 'warning') =>
        void bo.notify({ message: text, severity }).catch((error: unknown) =>
          bo.log.warn('A notification could not be shown', describeError(error)),
        );
      notify(message, 'success');
      for (const warning of warnings) {
        notify(warningText(warning, t), 'warning');
        bo.log.warn('A write left something to check', { bookingId, ...describeOutcome(warning) });
      }
    },
    [queryClient, bo, fleetId],
  );
}

/**
 * Logs a failed write, with what an administrator needs to fix it (the operator only sees the
 * dialog, which closes).
 *
 * @returns `report(failure, bookingId)`.
 */
export function useReportFailure(): (failure: OperationFailure, bookingId: string) => void {
  const bo = useBoClient();
  return useCallback(
    (failure, bookingId) => {
      const log = failure.kind === 'rollback-failed' || failure.kind === 'allocation-unknown' ? bo.log.error : bo.log.warn;
      log('A write failed', { bookingId, ...describeOutcome(failure) });
    },
    [bo],
  );
}
