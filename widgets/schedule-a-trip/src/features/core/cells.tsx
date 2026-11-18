import { Avatar, Box, Chip, IconButton, Tooltip, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@vulog/bo-widget-react';
import { customerName, initialsOf, isBusinessBooking } from '../../domain/customers';
import { useI18n } from '../../i18n';
import { modelsQueryOptions, vehicleCatalogQueryOptions } from '../../query/queries';
import { SkeletonCell } from '../../ui/SkeletonCell';
import type { BookingContext } from '../extensions';
import { useSection } from '../section-context';

/** The pattern of an exact date and time, in the locale of the back office. */
export const EXACT_DATE = 'Pp';

/**
 * A date as "in 2 hours", with the exact date and time below and the time zone in the tooltip.
 *
 * @param props - The ISO date, or `null` for the text shown without one.
 * @returns The cell.
 */
export function DateCell({ value, empty }: { readonly value: string | null; readonly empty: string }) {
  const { formatDateInZone, formatRelative } = useI18n();
  const { timeZone, now } = useSection();
  if (value === null) {
    return (
      <Typography variant="body2" color="text.secondary">
        {empty}
      </Typography>
    );
  }
  const date = new Date(value);
  const exact = formatDateInZone(date, EXACT_DATE, timeZone);
  return (
    <Tooltip title={timeZone ? `${exact} (${timeZone})` : exact}>
      {/* Two lines of 1.2 (about 31 px): they fit the row of every density. */}
      <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        <Typography variant="body2" noWrap sx={{ lineHeight: 1.2 }}>
          {formatRelative(date, now)}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div" sx={{ lineHeight: 1.2 }}>
          {exact}
        </Typography>
      </Box>
    </Tooltip>
  );
}

/**
 * The customer of a booking: initials, name and a B2B badge; a skeleton while loading, an error
 * with a retry, a dash for an unknown customer.
 *
 * @param props - The context of the row.
 * @returns The cell.
 */
export function CustomerCell({ ctx }: { readonly ctx: BookingContext }) {
  const { t } = useI18n();
  const { customerStatus, retryCustomers } = useSection();
  const status = customerStatus(ctx.booking.userId);
  if (status === 'loading') return <SkeletonCell />;
  if (status === 'error') {
    return (
      <Tooltip title={t('customer.loadFailed')}>
        <IconButton size="small" color="error" aria-label={t('customer.retry')} onClick={retryCustomers}>
          ⟳
        </IconButton>
      </Tooltip>
    );
  }
  const name = ctx.customer ? customerName(ctx.customer) : null;
  if (!ctx.customer || name === null) {
    return (
      <Typography variant="body2" color="text.secondary" title={ctx.booking.userId ?? undefined}>
        {t('common.none')}
      </Typography>
    );
  }
  const business = isBusinessBooking(ctx.customer, ctx.booking.profileId);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Avatar sx={{ width: 28, height: 28, fontSize: 12 }} aria-hidden="true">
        {initialsOf(name)}
      </Avatar>
      <Typography variant="body2" noWrap>
        {name}
      </Typography>
      {business && <Chip size="small" label={t('customer.b2b')} variant="outlined" />}
    </Box>
  );
}

/**
 * The model asked for by a booking, "Any model" without one.
 *
 * @param props - The model id.
 * @returns The cell.
 */
export function ModelCell({ modelId }: { readonly modelId: number | null }) {
  const { t } = useI18n();
  const authFetch = useAuthFetch();
  const { fleetId } = useSection();
  const models = useQuery({ ...modelsQueryOptions(authFetch, fleetId), enabled: modelId !== null });
  if (modelId === null) return <>{t('vehicle.anyModel')}</>;
  if (models.isPending) return <SkeletonCell />;
  const model = models.data?.find((candidate) => candidate.id === modelId);
  return <span title={String(modelId)}>{model?.name ?? `#${modelId}`}</span>;
}

/**
 * A plate, styled.
 *
 * @param props - The plate.
 * @returns The plate.
 */
export function Plate({ plate }: { readonly plate: string }) {
  return (
    <Box
      component="span"
      sx={{
        fontFamily: 'monospace',
        border: 1,
        borderColor: 'divider',
        borderRadius: 0.5,
        px: 0.75,
        py: 0.25,
        fontSize: 13,
        whiteSpace: 'nowrap',
      }}
    >
      {plate}
    </Box>
  );
}

/**
 * The plate of a vehicle, from the vehicle catalogue.
 *
 * @param props - The vehicle id.
 * @returns The plate, a skeleton while the catalogue loads, the id (muted, with the reason in a
 *   tooltip) when the plate is unknown or the catalogue failed.
 */
export function VehiclePlate({ vehicleId }: { readonly vehicleId: string }) {
  const authFetch = useAuthFetch();
  const { fleetId } = useSection();
  const { t } = useI18n();
  const catalog = useQuery(vehicleCatalogQueryOptions(authFetch, fleetId));
  if (catalog.isPending) return <SkeletonCell width={80} />;
  const plate = catalog.data?.find((vehicle) => vehicle.id === vehicleId)?.plate;
  if (plate) return <Plate plate={plate} />;
  // Never show an id as a plate: say why the plate is missing.
  return (
    <Tooltip title={catalog.isError ? t('vehicle.catalogFailed') : t('vehicle.unknown')}>
      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
        {vehicleId}
      </Typography>
    </Tooltip>
  );
}

/**
 * The vehicle of a booking: the allocated one, else the pre-allocated one (from the stored state),
 * else a dash.
 *
 * @param props - The context of the row.
 * @returns The cell.
 */
export function VehicleCell({ ctx }: { readonly ctx: BookingContext }) {
  const { t } = useI18n();
  const { statesFailed } = useSection();
  if (ctx.booking.vehicleId) return <VehiclePlate vehicleId={ctx.booking.vehicleId} />;
  const preallocated = ctx.state?.value.preallocatedVehicleId;
  if (preallocated) {
    return (
      <Tooltip title={t('vehicle.preallocatedHint')}>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          {ctx.state?.value.preallocatedPlate ? (
            <Plate plate={ctx.state.value.preallocatedPlate} />
          ) : (
            <VehiclePlate vehicleId={preallocated} />
          )}
          <Typography variant="caption" color="text.secondary">
            {t('vehicle.preallocatedShort')}
          </Typography>
        </Box>
      </Tooltip>
    );
  }
  if (ctx.state === undefined && !statesFailed) return <SkeletonCell width={80} />;
  return (
    <Typography variant="body2" color="text.secondary">
      {t('common.none')}
    </Typography>
  );
}
