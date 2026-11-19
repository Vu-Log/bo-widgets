import {
  Alert,
  Box,
  Button,
  Chip,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@vulog/bo-widget-react';
import { useMemo, useState } from 'react';
import { hasTripInProgress } from '../../api/schedule-a-trip';
import { unwrap } from '../../api/http';
import type { LiveVehicle } from '../../api/vehicles';
import { isHeldFor } from '../../domain/preallocation';
import { candidateVehicles, type VehicleCandidate } from '../../domain/vehicle-candidates';
import { vehiclesInRange, type VehicleWithDistance } from '../../domain/vehicles-in-range';
import { useI18n } from '../../i18n';
import { queryKeys } from '../../query/keys';
import { liveVehiclesQueryOptions, vehicleCatalogQueryOptions } from '../../query/queries';
import { SkeletonCell } from '../../ui/SkeletonCell';
import { MapView } from '../../ui/map/MapView';
import { queryErrorText } from '../core/common';
import { Plate } from '../core/cells';
import type { BookingContext } from '../extensions';
import { useSection } from '../section-context';
import { WriteDialogFrame, OperationError } from './dialogs';
import { allocate, preallocate, type OperationResult } from './operations';
import { failureText, useAfterWrite, useReportFailure, useWriteDeps } from './use-write';

/** Allocate a vehicle at once, or pre-allocate it (out of service until the start). */
export type PickMode = 'allocate' | 'preallocate';

/**
 * The live state of the vehicles as the picker of a booking sees them: its own pre-allocated
 * vehicle, out of service for it, counts as available when allocating; it is left out when
 * pre-allocating another.
 *
 * @param live - The live state of the vehicles.
 * @param bookingId - The booking.
 * @param preallocatedId - Its pre-allocated vehicle, if any.
 * @param mode - What the picker does.
 * @returns The vehicles to search in.
 */
export function pickableVehicles(
  live: readonly LiveVehicle[],
  bookingId: string,
  preallocatedId: string | null,
  mode: PickMode,
): LiveVehicle[] {
  return live.flatMap((vehicle) => {
    if (vehicle.id !== preallocatedId) return [vehicle];
    if (mode === 'preallocate') return [];
    return isHeldFor(vehicle.outOfServiceReason, bookingId) ? [{ ...vehicle, status: 'AVAILABLE' }] : [vehicle];
  });
}

/** One vehicle of the list. */
function VehicleRow({
  vehicle,
  inRange,
  onPick,
  onHover,
  disabled,
  label,
}: {
  readonly vehicle: VehicleWithDistance<VehicleCandidate>;
  readonly inRange: boolean;
  readonly onPick: () => void;
  readonly onHover: (id: string | null) => void;
  readonly disabled: boolean;
  readonly label: string;
}) {
  const { t, formatNumber } = useI18n();
  const details = [
    t('picker.distance', { meters: formatNumber(Math.round(vehicle.distanceMeters)) }),
    vehicle.energyLevel === null ? null : t('picker.energy', { percent: formatNumber(Math.round(vehicle.energyLevel)) }),
    vehicle.autonomy === null ? null : t('picker.autonomy', { value: formatNumber(Math.round(vehicle.autonomy)) }),
    vehicle.km === null ? null : t('picker.mileage', { km: formatNumber(Math.round(vehicle.km)) }),
  ].filter((detail): detail is string => detail !== null);
  return (
    <ListItem
      disablePadding
      onMouseEnter={() => onHover(vehicle.id)}
      onMouseLeave={() => onHover(null)}
      secondaryAction={
        <Button size="small" variant="contained" onClick={onPick} disabled={disabled}>
          {label}
        </Button>
      }
    >
      <ListItemButton onFocus={() => onHover(vehicle.id)} onClick={onPick} disabled={disabled} sx={{ pr: 16 }}>
        <ListItemText
          primary={
            <Box component="span" sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              {vehicle.plate ? <Plate plate={vehicle.plate} /> : vehicle.id}
              <span>{vehicle.modelName ?? vehicle.name ?? ''}</span>
              <Chip
                size="small"
                color={inRange ? 'success' : 'default'}
                label={inRange ? t('picker.inRange') : t('picker.outOfRange')}
              />
            </Box>
          }
          secondary={details.join(' · ')}
        />
      </ListItemButton>
    </ListItem>
  );
}

/**
 * Chooses a vehicle for a booking, on a map and in a list side by side: the available vehicles of
 * its service and model in its radius, or the 10 closest outside it, by distance. Allocates it, or
 * pre-allocates it (out of service until the start, with the booking id in its reason).
 *
 * @param props - What to do, the booking and the closing handler.
 * @returns The dialog.
 */
export function VehiclePickerDialog({
  mode,
  ctx,
  onClose,
}: {
  readonly mode: PickMode;
  readonly ctx: BookingContext;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const authFetch = useAuthFetch();
  const { fleetId, mapboxToken, vehicleSearchRadius } = useSection();
  const deps = useWriteDeps();
  const after = useAfterWrite();
  const report = useReportFailure();
  const { booking } = ctx;
  const [tab, setTab] = useState<'in' | 'out'>('in');
  const [hovered, setHovered] = useState<string | null>(null);
  const catalog = useQuery(vehicleCatalogQueryOptions(authFetch, fleetId));
  const live = useQuery({ ...liveVehiclesQueryOptions(authFetch, fleetId), staleTime: 0 });
  const busy = useQuery({
    queryKey: [...queryKeys.registration(fleetId, booking.userId ?? ''), 'trip-in-progress'],
    queryFn: async ({ signal }) => unwrap(await hasTripInProgress(authFetch, fleetId, booking.userId ?? '', signal)),
    enabled: mode === 'allocate' && booking.userId !== null,
  });
  const preallocatedId = ctx.state?.value.preallocatedVehicleId ?? null;
  const center = useMemo(
    () =>
      booking.latitude === null || booking.longitude === null
        ? null
        : { latitude: booking.latitude, longitude: booking.longitude },
    [booking.latitude, booking.longitude],
  );
  const radius = booking.radius ?? vehicleSearchRadius;

  const found = useMemo(() => {
    if (!center || !catalog.data || !live.data || booking.serviceId === null) return null;
    const vehicles = pickableVehicles(live.data, booking.id, preallocatedId, mode);
    return vehiclesInRange(candidateVehicles(catalog.data, vehicles, booking.serviceId), {
      serviceId: booking.serviceId,
      modelId: booking.modelId ?? 'any',
      center,
      radiusMeters: radius,
    });
  }, [center, catalog.data, live.data, booking, preallocatedId, mode, radius]);

  const mutation = useMutation({
    mutationFn: async (vehicle: VehicleCandidate): Promise<Extract<OperationResult, { ok: true }>> => {
      const result =
        mode === 'allocate'
          ? await allocate(deps, { id: booking.id, serviceId: booking.serviceId ?? '' }, vehicle.id)
          : await preallocate(deps, booking.id, { id: vehicle.id, plate: vehicle.plate });
      if (!result.ok) throw new OperationError(result);
      return result;
    },
    onSuccess: (result, vehicle) => {
      const message = t(mode === 'allocate' ? 'write.allocated' : 'write.preallocated', {
        plate: vehicle.plate ?? vehicle.id,
      });
      after(message, booking.id, result.state, result.warnings, t);
      onClose();
    },
    onError: (error) => {
      if (error instanceof OperationError) report(error.result.failure, booking.id);
    },
  });

  const shown = found ? (tab === 'in' ? found.inRange : found.closestOutOfRange) : [];
  const loadError = catalog.error ?? live.error;
  // Unknown is not "free": wait for the answer, and say when there is none.
  const blocked = mode === 'allocate' && booking.userId !== null && busy.data !== false;
  const pickLabel = mode === 'allocate' ? t('picker.allocate') : t('picker.preallocate');
  return (
    <WriteDialogFrame
      title={mode === 'allocate' ? t('picker.allocateTitle') : t('picker.preallocateTitle')}
      onClose={onClose}
      submitting={mutation.isPending}
      error={
        mutation.error instanceof OperationError
          ? null
          : mutation.error
            ? queryErrorText(mutation.error, t)
            : null
      }
      wide
    >
      {mutation.error instanceof OperationError && (
        <OperationFailureAlert error={mutation.error} />
      )}
      {mode === 'allocate' && busy.data === true && <Alert severity="warning">{t('picker.customerBusy')}</Alert>}
      {mode === 'allocate' && busy.isError && (
        <Alert severity="error">{t('picker.customerCheckFailed', { reason: queryErrorText(busy.error, t) })}</Alert>
      )}
      {mode === 'preallocate' && <Alert severity="info">{t('picker.preallocateHint')}</Alert>}
      {center === null || booking.serviceId === null ? (
        <Alert severity="warning">{t('picker.noPickup')}</Alert>
      ) : loadError ? (
        <Alert severity="error" role="alert">
          {queryErrorText(loadError, t)}
        </Alert>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, minHeight: 360 }}>
          <MapView
            token={mapboxToken}
            center={center}
            radiusMeters={radius}
            height={360}
            label={t('trip.mapLabel', { meters: radius })}
            markers={(found ? [...found.inRange, ...found.closestOutOfRange] : []).map((vehicle) => ({
              id: vehicle.id,
              point: vehicle.location ?? center,
              tone: vehicle.distanceMeters <= radius ? 'ok' : 'muted',
              highlighted: vehicle.id === hovered,
              label: vehicle.plate ?? vehicle.id,
            }))}
            onMarkerClick={setHovered}
            onMarkerHover={setHovered}
          />
          <Box sx={{ display: 'grid', gap: 1, alignContent: 'start' }}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={tab}
              onChange={(_, value: 'in' | 'out' | null) => value && setTab(value)}
            >
              <ToggleButton value="in" sx={{ textTransform: 'none' }}>
                {t('picker.inRangeTab', { count: found?.inRange.length ?? 0 })}
              </ToggleButton>
              <ToggleButton value="out" sx={{ textTransform: 'none' }}>
                {t('picker.outOfRangeTab', { count: found?.closestOutOfRange.length ?? 0 })}
              </ToggleButton>
            </ToggleButtonGroup>
            {!found ? (
              <Box aria-busy="true">
                <SkeletonCell />
                <SkeletonCell />
              </Box>
            ) : shown.length === 0 ? (
              <Typography color="text.secondary">
                {tab === 'in' ? t('picker.noneInRange') : t('picker.noneOutOfRange')}
              </Typography>
            ) : (
              <List dense sx={{ maxHeight: 320, overflow: 'auto' }} aria-label={t('picker.listLabel')}>
                {shown.map((vehicle) => (
                  <VehicleRow
                    key={vehicle.id}
                    vehicle={vehicle}
                    inRange={tab === 'in'}
                    onPick={() => mutation.mutate(vehicle)}
                    onHover={setHovered}
                    disabled={mutation.isPending || blocked}
                    label={pickLabel}
                  />
                ))}
              </List>
            )}
          </Box>
        </Box>
      )}
    </WriteDialogFrame>
  );
}

/** The failure of an operation, translated. */
function OperationFailureAlert({ error }: { readonly error: OperationError }) {
  const { t } = useI18n();
  return (
    <Alert severity="error" role="alert">
      {failureText(error.result.failure, t)}
    </Alert>
  );
}

