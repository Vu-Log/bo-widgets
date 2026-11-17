import { Alert, Box, Card, CardContent, Chip, Link, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useBoClient, useBoRouter } from '@vulog/bo-widget-react';
import type { ReactNode } from 'react';
import { apiErrorText, ApiRequestError } from '../../api/http';
import { customerName, isBusinessBooking } from '../../domain/customers';
import { useI18n } from '../../i18n';
import { bookingAddressQueryOptions } from '../../query/queries';
import { SkeletonCell } from '../../ui/SkeletonCell';
import { StaticMap } from '../../ui/StaticMap';
import type { BookingContext } from '../extensions';
import { useSection } from '../section-context';
import { EXACT_DATE, ModelCell, Plate, VehiclePlate } from './cells';

/**
 * A card of the detail drawer, with its title and an optional action.
 *
 * @param props - Title, action and content.
 * @returns The card.
 */
export function DetailCardFrame({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Card variant="outlined" component="section" aria-label={title}>
      <CardContent sx={{ display: 'grid', gap: 1.5, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="subtitle1" component="h3" sx={{ flex: 1 }}>
            {title}
          </Typography>
          {action}
        </Box>
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * Fields of a card, as a definition list of two columns.
 *
 * @param props - Pairs of label and value; a `null` value leaves its pair out.
 * @returns The list.
 */
export function Fields({ items }: { readonly items: readonly (readonly [string, ReactNode | null])[] }) {
  return (
    <Box
      component="dl"
      sx={{ display: 'grid', gridTemplateColumns: 'minmax(110px, auto) 1fr', gap: 1, m: 0 }}
    >
      {items
        .filter(([, value]) => value !== null)
        .map(([label, value]) => (
          <Box key={label} sx={{ display: 'contents' }}>
            <Typography component="dt" variant="body2" color="text.secondary">
              {label}
            </Typography>
            <Typography component="dd" variant="body2" sx={{ m: 0, minWidth: 0, overflowWrap: 'anywhere' }}>
              {value}
            </Typography>
          </Box>
        ))}
    </Box>
  );
}

/** A link to a page of the back office, through `navigate`. */
function BoLink({ path, children }: { readonly path: string; readonly children: ReactNode }) {
  const { navigate } = useBoRouter();
  const bo = useBoClient();
  return (
    <Link
      component="button"
      type="button"
      variant="body2"
      onClick={() =>
        navigate(path).catch((error: unknown) =>
          bo.log.warn('Navigation to a back office page failed', {
            path,
            message: error instanceof Error ? error.message : String(error),
          }),
        )
      }
    >
      {children}
    </Link>
  );
}

/** A date in the zone of the fleet. */
function ExactDate({ value }: { readonly value: string }) {
  const { formatDateInZone, formatRelative } = useI18n();
  const { timeZone, now } = useSection();
  const date = new Date(value);
  return (
    <>
      {formatDateInZone(date, EXACT_DATE, timeZone)}{' '}
      <Typography component="span" variant="caption" color="text.secondary">
        ({formatRelative(date, now)})
      </Typography>
    </>
  );
}

/** The address of a point, from the reverse geocoding (persisted). */
function Address({ latitude, longitude }: { readonly latitude: number; readonly longitude: number }) {
  const { t, language } = useI18n();
  const { mapboxToken } = useSection();
  const point = { latitude, longitude };
  const address = useQuery({
    ...bookingAddressQueryOptions(mapboxToken ?? '', point, language),
    enabled: mapboxToken !== null,
  });
  const coordinates = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  if (mapboxToken === null) return <>{coordinates}</>;
  if (address.isPending) return <SkeletonCell />;
  if (address.isError) {
    return (
      <span title={t('trip.addressFailed')}>
        {coordinates}
      </span>
    );
  }
  return (
    <>
      {address.data ?? t('trip.noAddress')}
      <Typography variant="caption" color="text.secondary" component="div">
        {coordinates}
      </Typography>
    </>
  );
}

/**
 * The trip of a booking: dates in the zone of the fleet, pickup address, radius, map, notes of the
 * customer, alert reason and the link to its trip.
 *
 * @param props - The context of the booking, and an action for the title (an edit button).
 * @returns The card.
 */
export function TripCard({ ctx, action }: { readonly ctx: BookingContext; readonly action?: ReactNode }) {
  const { t, formatNumber } = useI18n();
  const { mapboxToken } = useSection();
  const { booking } = ctx;
  const hoursBefore =
    booking.cancellationDate === null
      ? null
      : (Date.parse(booking.startDate) - Date.parse(booking.cancellationDate)) / 3_600_000;
  const located = booking.latitude !== null && booking.longitude !== null;
  const tripState = ctx.tab === 'ongoing' ? 'ongoing' : 'completed';
  return (
    <DetailCardFrame title={t('trip.title')} action={action}>
      {booking.failureReason && <Alert severity="warning">{booking.failureReason}</Alert>}
      <Fields
        items={[
          [t('trip.start'), <ExactDate key="start" value={booking.startDate} />],
          [
            t('trip.plannedReturn'),
            booking.plannedReturnDate ? (
              <ExactDate key="return" value={booking.plannedReturnDate} />
            ) : (
              <Chip size="small" label={t('trip.noReturnDate')} />
            ),
          ],
          [t('trip.end'), booking.endDate ? <ExactDate key="end" value={booking.endDate} /> : null],
          [
            t('trip.cancelled'),
            booking.cancellationDate ? (
              <>
                <ExactDate value={booking.cancellationDate} />{' '}
                {hoursBefore !== null &&
                  t('trip.hoursBeforeStart', {
                    hours: formatNumber(hoursBefore, { maximumFractionDigits: 1 }),
                  })}
              </>
            ) : null,
          ],
          [t('trip.created'), booking.creationDate ? <ExactDate value={booking.creationDate} /> : null],
          [
            t('trip.address'),
            located ? (
              <Address latitude={booking.latitude ?? 0} longitude={booking.longitude ?? 0} />
            ) : (
              t('common.none')
            ),
          ],
          [
            t('trip.radius'),
            booking.radius === null ? null : t('trip.meters', { meters: formatNumber(booking.radius) }),
          ],
          [t('trip.customerNotes'), booking.notes],
          [
            t('trip.trip'),
            booking.journeyId && (ctx.tab === 'ongoing' || ctx.tab === 'completed') ? (
              <BoLink path={`/app/trips/${tripState}/${encodeURIComponent(booking.journeyId)}`}>
                {t('trip.openTrip')}
              </BoLink>
            ) : null,
          ],
        ]}
      />
      {located && (
        <StaticMap
          token={mapboxToken}
          center={{ latitude: booking.latitude ?? 0, longitude: booking.longitude ?? 0 }}
          radiusMeters={booking.radius}
          label={t('trip.mapLabel', { meters: booking.radius ?? 0 })}
        />
      )}
    </DetailCardFrame>
  );
}

/**
 * The vehicle of a booking: model asked for, vehicle allocated (with a link to its page), vehicle
 * pre-allocated by the widget.
 *
 * @param props - The context of the booking, and an action for the title.
 * @returns The card.
 */
export function VehicleCard({
  ctx,
  action,
  children,
}: {
  readonly ctx: BookingContext;
  readonly action?: ReactNode;
  readonly children?: ReactNode;
}) {
  const { t } = useI18n();
  const { booking, state } = ctx;
  const preallocatedId = state?.value.preallocatedVehicleId ?? null;
  return (
    <DetailCardFrame title={t('vehicle.title')} action={action}>
      <Fields
        items={[
          [t('vehicle.model'), <ModelCell key="model" modelId={booking.modelId} />],
          [
            t('vehicle.allocated'),
            booking.vehicleId ? (
              <BoLink path={`/app/new-vehicles/${encodeURIComponent(booking.vehicleId)}`}>
                <VehiclePlate vehicleId={booking.vehicleId} />
              </BoLink>
            ) : (
              t('common.none')
            ),
          ],
          [
            t('vehicle.preallocated'),
            preallocatedId ? (
              <>
                <BoLink path={`/app/new-vehicles/${encodeURIComponent(preallocatedId)}`}>
                  {state?.value.preallocatedPlate ? (
                    <Plate plate={state.value.preallocatedPlate} />
                  ) : (
                    <VehiclePlate vehicleId={preallocatedId} />
                  )}
                </BoLink>
                <Typography variant="caption" color="text.secondary" component="div">
                  {t('vehicle.preallocatedHint')}
                </Typography>
              </>
            ) : null,
          ],
        ]}
      />
      {children}
    </DetailCardFrame>
  );
}

/**
 * The customer of a booking: name, user name, profile (B2B or not), with a link to their page.
 *
 * @param props - The context of the booking.
 * @returns The card.
 */
export function CustomerCard({ ctx }: { readonly ctx: BookingContext }) {
  const { t } = useI18n();
  const { customerStatus } = useSection();
  const { booking, customer } = ctx;
  const status = customerStatus(booking.userId);
  const name = customer ? customerName(customer) : null;
  const business = customer ? isBusinessBooking(customer, booking.profileId) : null;
  const profilePath =
    booking.userId && booking.profileId
      ? `/app/users/${encodeURIComponent(booking.userId)}/profile/${encodeURIComponent(booking.profileId)}`
      : null;
  return (
    <DetailCardFrame title={t('customer.title')}>
      {status === 'loading' && !customer ? (
        <SkeletonCell />
      ) : status === 'error' ? (
        <Alert severity="error">{t('customer.loadFailed')}</Alert>
      ) : (
        <Fields
          items={[
            [
              t('customer.name'),
              name && profilePath ? <BoLink path={profilePath}>{name}</BoLink> : (name ?? t('common.none')),
            ],
            [t('customer.userName'), customer?.userName ?? null],
            [
              t('customer.profile'),
              business === null ? null : business ? t('customer.business') : t('customer.single'),
            ],
          ]}
        />
      )}
    </DetailCardFrame>
  );
}

/**
 * The message of a failed query, translated: a 403 says the action is not allowed.
 *
 * @param error - The error of a query.
 * @param t - `useI18n().t`.
 * @returns The message.
 */
export function queryErrorText(error: Error, t: ReturnType<typeof useI18n>['t']): string {
  if (error instanceof ApiRequestError) {
    const { key, params } = apiErrorText(error.error);
    return t(key, params);
  }
  return t('common.unexpectedError');
}
