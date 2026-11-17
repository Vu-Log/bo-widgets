import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { isPermanentApiError, type ApiError, type ApiResult } from '../../api/http';
import {
  allocateVehicle,
  cancelBookingRequest,
} from '../../api/schedule-a-trip';
import { disableVehicle, enableVehicle } from '../../api/vehicles';
import { isHeldFor, preallocationReason } from '../../domain/preallocation';
import {
  createBookingState,
  readBookingState,
  updateBookingState,
  withEvent,
  type BookingStateCollection,
  type BookingStateDoc,
  type StorageFailure,
} from '../../storage/booking-state';

/** What the write operations need. */
export interface WriteDeps {
  readonly authFetch: AuthFetch;
  readonly collection: BookingStateCollection;
  readonly fleetId: string;
  /** `getCurrentUser().id`, for the journal; never an email. */
  readonly userId: string | null;
  readonly now: () => Date;
  /** Reads again the state of a vehicle now: its out of service reason, `null` when in service. */
  readonly reasonOf: (vehicleId: string) => Promise<ApiResult<VehicleReason>>;
}

/** What {@link WriteDeps.reasonOf} found: the vehicle may be missing from the fleet manager. */
export type VehicleReason =
  | { readonly found: false }
  | { readonly found: true; readonly reason: string | null };

/**
 * Why an operation failed. Nothing was changed, except for `rollback-failed` (a vehicle could not
 * be put back as it was) and `allocation-unknown` (the allocation may have been done): the
 * operator must check in the back office.
 */
export type OperationFailure =
  | { readonly kind: 'api'; readonly error: ApiError }
  | { readonly kind: 'storage'; readonly error: StorageFailure }
  /** The scheduler already handled the booking: its pre-allocation must not change. */
  | { readonly kind: 'already-processed' }
  /**
   * The allocation got no answer and may have been done: the pre-allocated vehicle chosen was left
   * in service. Check the booking and the vehicle.
   */
  | { readonly kind: 'allocation-unknown'; readonly vehicleId: string }
  /** The vehicle chosen is out of service (or missing) now: someone else took it. */
  | { readonly kind: 'vehicle-unavailable'; readonly vehicleId: string }
  /**
   * A vehicle changed (put out of service, or back in service) could not be put back as it was.
   * `cause` is why the operation failed, `error` why the undo failed.
   */
  | {
      readonly kind: 'rollback-failed';
      readonly vehicleId: string;
      readonly error: ApiError;
      readonly cause: ApiError | StorageFailure;
    };

/** Something left to check after an operation that succeeded. */
export type OperationWarning =
  /**
   * The previous vehicle could not be put back in service: do it in the back office. The stored
   * state still names it, so that the operator can try again.
   */
  | { readonly kind: 'vehicle-not-enabled'; readonly vehicleId: string }
  /** The state of the previous vehicle could not be read: it was left as it is. */
  | { readonly kind: 'vehicle-not-checked'; readonly vehicleId: string }

  /** The previous vehicle is out of service for another reason now: left as it is. */
  | { readonly kind: 'vehicle-held-elsewhere'; readonly vehicleId: string }
  /** The stored state could not be updated: it still names the pre-allocated vehicle. */
  | { readonly kind: 'state-not-updated'; readonly error: StorageFailure };

/** The outcome of an operation: the stored state after it, and what to check. */
export type OperationResult =
  | {
      readonly ok: true;
      /** The stored state after the operation; `undefined` when it was not read or not changed. */
      readonly state: BookingStateDoc | null | undefined;
      readonly warnings: readonly OperationWarning[];
    }
  | { readonly ok: false; readonly failure: OperationFailure };

const failed = (failure: OperationFailure): OperationResult => ({ ok: false, failure });

/** A vehicle and its plate, as recorded in the stored state. */
export interface PickedVehicle {
  readonly id: string;
  readonly plate: string | null;
}

/**
 * Puts back in service a vehicle held for the booking; leaves one held for something else, or
 * whose state cannot be read. Never throws: what went wrong is a warning.
 */
async function freeVehicle(
  deps: WriteDeps,
  bookingId: string,
  vehicleId: string,
): Promise<OperationWarning | null> {
  const read = await deps.reasonOf(vehicleId);
  if (!read.ok || !read.data.found) return { kind: 'vehicle-not-checked', vehicleId };
  if (!isHeldFor(read.data.reason, bookingId)) return { kind: 'vehicle-held-elsewhere', vehicleId };
  const enabled = await enableVehicle(deps.authFetch, deps.fleetId, vehicleId);
  return enabled.ok ? null : { kind: 'vehicle-not-enabled', vehicleId };
}

const at = (deps: WriteDeps) => deps.now().toISOString();

/**
 * Pre-allocates a vehicle to a booking: puts it out of service with a reason naming the booking,
 * records it in the stored state (created if needed), then puts the previous pre-allocated vehicle
 * back in service if it is still held for the booking. When the state cannot be written, the new
 * vehicle is put back in service. Refused once the scheduler handled the booking.
 *
 * @param deps - API, storage, fleet, operator and clock.
 * @param bookingId - The booking.
 * @param vehicle - The vehicle chosen.
 * @returns The stored state written and what to check, or why nothing changed.
 */
export async function preallocate(
  deps: WriteDeps,
  bookingId: string,
  vehicle: PickedVehicle,
): Promise<OperationResult> {
  const read = await readBookingState(deps.collection, bookingId);
  if (!read.ok) return failed({ kind: 'storage', error: read.error });
  const current = read.value;
  if (current?.value.allocationProcessed) return failed({ kind: 'already-processed' });
  const previousId = current?.value.preallocatedVehicleId ?? null;
  if (previousId === vehicle.id) return { ok: true, state: current, warnings: [] };

  // The list may be some seconds old: never take a vehicle someone put out of service meanwhile.
  const chosen = await deps.reasonOf(vehicle.id);
  if (!chosen.ok) return failed({ kind: 'api', error: chosen.error });
  if (!chosen.data.found || chosen.data.reason !== null) {
    return failed({ kind: 'vehicle-unavailable', vehicleId: vehicle.id });
  }

  const disabled = await disableVehicle(
    deps.authFetch,
    deps.fleetId,
    vehicle.id,
    preallocationReason(bookingId),
  );
  if (!disabled.ok) return failed({ kind: 'api', error: disabled.error });

  const patch = {
    preallocatedVehicleId: vehicle.id,
    preallocatedPlate: vehicle.plate,
    events: withEvent(current?.value.events, {
      at: at(deps),
      by: deps.userId,
      type: 'preallocated',
      details: { vehicleId: vehicle.id, previousVehicleId: previousId },
    }),
  };
  const written =
    current === null
      ? await createBookingState(deps.collection, bookingId, { fleetId: deps.fleetId, patch })
      : await updateBookingState(deps.collection, current, patch);
  if (!written.ok) {
    const rollback = await enableVehicle(deps.authFetch, deps.fleetId, vehicle.id);
    if (!rollback.ok) {
      return failed({
        kind: 'rollback-failed',
        vehicleId: vehicle.id,
        error: rollback.error,
        cause: written.error,
      });
    }
    return failed({ kind: 'storage', error: written.error });
  }

  const warning = previousId === null ? null : await freeVehicle(deps, bookingId, previousId);
  return { ok: true, state: written.value, warnings: warning ? [warning] : [] };
}

/** Puts the pre-allocated vehicle back in service and forgets it in the stored state. */
async function release(
  deps: WriteDeps,
  bookingId: string,
  current: BookingStateDoc,
  eventType: string,
  keepVehicle = false,
): Promise<{ state: BookingStateDoc; warnings: OperationWarning[] }> {
  const vehicleId = current.value.preallocatedVehicleId;
  if (!vehicleId) return { state: current, warnings: [] };
  const warning = keepVehicle ? null : await freeVehicle(deps, bookingId, vehicleId);
  const warnings: OperationWarning[] = warning ? [warning] : [];
  // Still out of service for the booking: keep it in the state, so that it can be freed later.
  if (warning?.kind === 'vehicle-not-enabled') return { state: current, warnings };
  const written = await updateBookingState(deps.collection, current, {
    preallocatedVehicleId: null,
    preallocatedPlate: null,
    events: withEvent(current.value.events, {
      at: at(deps),
      by: deps.userId,
      type: eventType,
      details: { vehicleId },
    }),
  });
  if (!written.ok) return { state: current, warnings: [...warnings, { kind: 'state-not-updated', error: written.error }] };
  return { state: written.value, warnings };
}

/**
 * Removes the pre-allocation of a booking: its vehicle back in service (if still held for it) and
 * the stored state cleared. Refused once the scheduler handled the booking.
 *
 * @param deps - API, storage, fleet, operator and clock.
 * @param bookingId - The booking.
 * @returns The stored state written and what to check, or why nothing changed.
 */
export async function removePreallocation(deps: WriteDeps, bookingId: string): Promise<OperationResult> {
  const read = await readBookingState(deps.collection, bookingId);
  if (!read.ok) return failed({ kind: 'storage', error: read.error });
  if (read.value === null) return { ok: true, state: null, warnings: [] };
  if (read.value.value.allocationProcessed) return failed({ kind: 'already-processed' });
  // The vehicle may be back in service already: a state not updated is a warning, not a failure.
  const released = await release(deps, bookingId, read.value, 'preallocation-removed');
  return { ok: true, state: released.state, warnings: released.warnings };
}

/** Releases the pre-allocation after the booking was allocated or cancelled, as warnings only. */
async function releaseAfter(
  deps: WriteDeps,
  bookingId: string,
  eventType: string,
  /** The vehicle the booking got: when it is the pre-allocated one, it stays as it is. */
  allocatedId: string | null = null,
): Promise<OperationResult> {
  const read = await readBookingState(deps.collection, bookingId);
  if (!read.ok) return { ok: true, state: undefined, warnings: [{ kind: 'state-not-updated', error: read.error }] };
  const current = read.value;
  if (current === null || !current.value.preallocatedVehicleId || current.value.allocationProcessed) {
    return { ok: true, state: current, warnings: [] };
  }
  const keepVehicle = current.value.preallocatedVehicleId === allocatedId;
  const released = await release(deps, bookingId, current, eventType, keepVehicle);
  return { ok: true, state: released.state, warnings: released.warnings };
}

/**
 * Allocates a vehicle to a booking. When it is the pre-allocated vehicle, it is put back in service
 * first (and out of service again if the allocation fails); another pre-allocated vehicle is put
 * back in service after. The stored state then forgets the pre-allocation.
 *
 * @param deps - API, storage, fleet, operator and clock.
 * @param booking - Id and service of the booking.
 * @param vehicleId - The vehicle chosen.
 * @returns What to check, or why the vehicle was not allocated.
 */
export async function allocate(
  deps: WriteDeps,
  booking: { readonly id: string; readonly serviceId: string },
  vehicleId: string,
): Promise<OperationResult> {
  const read = await readBookingState(deps.collection, booking.id);
  if (!read.ok) return failed({ kind: 'storage', error: read.error });
  const preallocated = read.value?.value.preallocatedVehicleId ?? null;
  let heldVehicle = false;
  if (preallocated === vehicleId) {
    const reason = await deps.reasonOf(vehicleId);
    if (!reason.ok) return failed({ kind: 'api', error: reason.error });
    heldVehicle = reason.data.found && isHeldFor(reason.data.reason, booking.id);
  }
  if (heldVehicle) {
    const enabled = await enableVehicle(deps.authFetch, deps.fleetId, vehicleId);
    if (!enabled.ok) return failed({ kind: 'api', error: enabled.error });
  }
  const allocated = await allocateVehicle(deps.authFetch, deps.fleetId, booking.id, vehicleId, booking.serviceId);
  if (!allocated.ok) {
    if (heldVehicle) {
      // Without an answer, the allocation may have been done: never take that vehicle out of service.
      if (!isPermanentApiError(allocated.error)) {
        return failed({ kind: 'allocation-unknown', vehicleId });
      }
      const back = await disableVehicle(deps.authFetch, deps.fleetId, vehicleId, preallocationReason(booking.id));
      if (!back.ok) {
        return failed({ kind: 'rollback-failed', vehicleId, error: back.error, cause: allocated.error });
      }
    }
    return failed({ kind: 'api', error: allocated.error });
  }
  return releaseAfter(deps, booking.id, 'allocated', vehicleId);
}

/**
 * Cancels a booking, then puts its pre-allocated vehicle back in service (if still held for it) and
 * forgets it in the stored state.
 *
 * @param deps - API, storage, fleet, operator and clock.
 * @param bookingId - The booking.
 * @returns What to check, or why the booking was not cancelled.
 */
export async function cancel(deps: WriteDeps, bookingId: string): Promise<OperationResult> {
  const cancelled = await cancelBookingRequest(deps.authFetch, deps.fleetId, bookingId);
  if (!cancelled.ok) return failed({ kind: 'api', error: cancelled.error });
  return releaseAfter(deps, bookingId, 'cancelled');
}
