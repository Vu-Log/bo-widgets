import { Autocomplete, Box, TextField } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { forwardGeocode, type GeocodedPlace } from '../../api/mapbox';
import { unwrap } from '../../api/http';
import { isValidRadius, MAX_RADIUS, toZonedInput, fromZonedInput } from '../../domain/booking-dates';
import { useI18n } from '../../i18n';
import { queryKeys } from '../../query/keys';
import { StaticMap } from '../../ui/StaticMap';
import { useSection } from '../section-context';

/** The dates of a booking being edited. */
export interface DatesValue {
  readonly start: Date | null;
  readonly plannedReturn: Date | null;
}

/**
 * The start and the planned return of a booking, typed in the time zone of the fleet.
 *
 * @param props - The dates, their setter and the errors to show.
 * @returns The fields.
 */
export function DateFields({
  value,
  onChange,
  errors,
}: {
  readonly value: DatesValue;
  readonly onChange: (value: DatesValue) => void;
  readonly errors: { readonly start?: string; readonly plannedReturn?: string };
}) {
  const { t } = useI18n();
  const { timeZone } = useSection();
  const input = (date: Date | null) => (date === null ? '' : toZonedInput(date, timeZone));
  const helper = timeZone ? t('form.timeZone', { zone: timeZone }) : undefined;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
      <TextField
        type="datetime-local"
        label={t('trip.start')}
        value={input(value.start)}
        onChange={(event) => onChange({ ...value, start: fromZonedInput(event.target.value, timeZone) })}
        error={Boolean(errors.start)}
        helperText={errors.start ?? helper}
        required
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        type="datetime-local"
        label={t('trip.plannedReturn')}
        value={input(value.plannedReturn)}
        onChange={(event) =>
          onChange({ ...value, plannedReturn: fromZonedInput(event.target.value, timeZone) })
        }
        error={Boolean(errors.plannedReturn)}
        helperText={errors.plannedReturn ?? t('form.optional')}
        slotProps={{ inputLabel: { shrink: true } }}
      />
    </Box>
  );
}

/** The pickup point of a booking being edited. */
export interface PickupValue {
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly radius: number;
}

/**
 * Whether a pickup point can be sent: located, with a valid radius.
 *
 * @param value - The pickup point.
 * @returns `true` when complete.
 */
export const isPickupComplete = (value: PickupValue): boolean =>
  value.latitude !== null && value.longitude !== null && isValidRadius(value.radius);

const SEARCH_DELAY_MS = 300;

/** A text, once it stopped changing for a while. */
function useSettled(text: string): string {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(text), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);
  return settled;
}

/**
 * The pickup point of a booking: an address search (Mapbox geocoding), the map to click, the
 * coordinates and the radius. Without a Mapbox token, the coordinates are typed.
 *
 * @param props - The pickup point and its setter.
 * @returns The fields.
 */
export function PickupFields({
  value,
  onChange,
}: {
  readonly value: PickupValue;
  readonly onChange: (value: PickupValue) => void;
}) {
  const { t, language } = useI18n();
  const { mapboxToken } = useSection();
  const [text, setText] = useState('');
  const settled = useSettled(text).trim();
  const proximity =
    value.latitude !== null && value.longitude !== null
      ? { latitude: value.latitude, longitude: value.longitude }
      : null;
  const search = useQuery({
    queryKey: queryKeys.addressSearch(settled, language),
    queryFn: async ({ signal }) =>
      unwrap(await forwardGeocode(mapboxToken ?? '', settled, language, proximity, undefined, signal)),
    enabled: mapboxToken !== null && settled.length >= 3,
    staleTime: 5 * 60_000,
  });
  const coordinate = (raw: string): number | null => {
    const number = Number.parseFloat(raw);
    return Number.isFinite(number) ? number : null;
  };
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {mapboxToken !== null && (
        <Autocomplete<GeocodedPlace>
          options={search.data ?? []}
          getOptionLabel={(place) => place.label}
          filterOptions={(options) => options}
          loading={search.isFetching}
          inputValue={text}
          onInputChange={(_, next) => setText(next)}
          onChange={(_, place) => {
            if (place) onChange({ ...value, ...place.point });
          }}
          noOptionsText={search.isError ? t('form.addressFailed') : t('form.noAddress')}
          renderInput={(params) => <TextField {...params} label={t('form.addressSearch')} />}
        />
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2 }}>
        <TextField
          type="number"
          label={t('form.latitude')}
          value={value.latitude ?? ''}
          onChange={(event) => onChange({ ...value, latitude: coordinate(event.target.value) })}
          slotProps={{ htmlInput: { step: 'any', min: -90, max: 90 } }}
        />
        <TextField
          type="number"
          label={t('form.longitude')}
          value={value.longitude ?? ''}
          onChange={(event) => onChange({ ...value, longitude: coordinate(event.target.value) })}
          slotProps={{ htmlInput: { step: 'any', min: -180, max: 180 } }}
        />
        <TextField
          type="number"
          label={t('form.radius')}
          value={Number.isNaN(value.radius) ? '' : value.radius}
          onChange={(event) => onChange({ ...value, radius: Number(event.target.value) })}
          error={!isValidRadius(value.radius)}
          helperText={isValidRadius(value.radius) ? undefined : t('form.radiusInvalid', { max: MAX_RADIUS })}
          slotProps={{ htmlInput: { step: 1, min: 1, max: MAX_RADIUS } }}
        />
      </Box>
      {proximity && (
        <StaticMap
          token={mapboxToken}
          center={proximity}
          radiusMeters={isValidRadius(value.radius) ? value.radius : null}
          label={t('form.mapPick')}
          onPick={(point) => onChange({ ...value, ...point })}
        />
      )}
    </Box>
  );
}
