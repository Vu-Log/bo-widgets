import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useBoClient, useBoContext } from '@vulog/bo-widget-react';
import { queryKeys } from '../query/keys';
import { settingsSchema } from '../settings';

/**
 * The settings the booking section needs, each read on its own: a missing prepayment product must
 * not take the maps away. A value that is missing or invalid gives its default (`null` for the map
 * token and the time zone).
 */
export interface SectionSettings {
  /** Public Mapbox token, `null` without a valid one: no map nor geocoding. */
  readonly mapboxToken: string | null;
  /** Default radius of the vehicle search, in meters. */
  readonly vehicleSearchRadius: number;
  /** Time zone of the settings, used when the fleet gives none. */
  readonly timezone: string | null;
}

const DEFAULT_RADIUS = 500;
const fields = settingsSchema.shape;

const readField = <T>(schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }, value: unknown): T | undefined => {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

/**
 * Reads the settings of the booking section from the raw `getSettings()`, field by field.
 *
 * @param raw - What `getSettings()` resolved with.
 * @returns The settings, with their defaults for what is missing or invalid.
 */
export function parseSectionSettings(raw: unknown): SectionSettings {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    mapboxToken: readField<string>(fields.mapboxToken, record.mapboxToken) ?? null,
    vehicleSearchRadius:
      readField<number>(fields.vehicleSearchRadius, record.vehicleSearchRadius) ?? DEFAULT_RADIUS,
    timezone: readField<string | undefined>(fields.timezone, record.timezone) ?? null,
  };
}

/**
 * The settings of the booking section, in memory only. Fails only when the back office cannot
 * answer `getSettings()`.
 *
 * @returns The TanStack Query result of {@link parseSectionSettings}.
 */
export function useSectionSettings(): UseQueryResult<SectionSettings, Error> {
  const bo = useBoClient();
  return useQuery({
    queryKey: queryKeys.sectionSettings(),
    queryFn: async () => parseSectionSettings(await bo.getSettings()),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

const isTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
};

/**
 * The time zone to show the dates of the fleet in: the fleet's, else the one of the settings, else
 * `null` (the browser's). A zone the browser does not know is skipped.
 *
 * @param fleetZone - `getContext().timezone`.
 * @param settingsZone - `timezone` of the settings.
 * @returns An IANA time zone, or `null`.
 */
export function fleetTimeZone(fleetZone: string | null, settingsZone: string | null): string | null {
  for (const zone of [fleetZone, settingsZone]) if (zone && isTimeZone(zone)) return zone;
  return null;
}

/**
 * The time zone of the fleet ({@link fleetTimeZone}), `null` while the settings load.
 *
 * @returns An IANA time zone, or `null` for the browser's.
 */
export function useFleetTimeZone(): string | null {
  const { timezone } = useBoContext();
  const settings = useSectionSettings();
  return fleetTimeZone(timezone, settings.data?.timezone ?? null);
}
