import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useBoClient } from '@vulog/bo-widget-react';
import { z } from 'zod';
import { queryKeys } from './query/keys';

/** A blank string (or no value) is "not set" for an optional text setting. */
const optionalText = (schema: z.ZodString) =>
  z.preprocess(
    (value) =>
      value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value,
    schema.optional(),
  );

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
 * The installation settings of the widget, as `getSettings()` returns them. The manifest
 * (`widget.config.ts`) declares the same keys and defaults.
 */
export const settingsSchema = z
  .object({
    prepaymentProductId: z.uuid(),
    cancellationFeesProductId: z.uuid(),
    dayRate: z.number().positive(),
    ratio: z.number().positive(),
    minimumAmount: z.number().positive(),
    refundFullHours: z.number().nonnegative().default(24),
    creditsRevokeHours: z.number().nonnegative().default(1),
    vehicleSearchRadius: z.number().positive().default(500),
    mapboxToken: z
      .string()
      .trim()
      .startsWith('pk.', 'Expected a public Mapbox token (pk.…), never a secret one'),
    currency: optionalText(
      z
        .string()
        .trim()
        .regex(/^[A-Z]{3}$/, 'Expected an ISO 4217 code, such as EUR'),
    ),
    timezone: optionalText(
      z.string().trim().refine(isTimeZone, 'Expected an IANA time zone, such as Europe/Paris'),
    ),
  })
  .refine((settings) => settings.creditsRevokeHours <= settings.refundFullHours, {
    path: ['creditsRevokeHours'],
    message: 'Must not be greater than refundFullHours',
  });

/** The validated settings of the installation. */
export type WidgetSettings = z.output<typeof settingsSchema>;

/** A setting that is missing or invalid: its key and why. */
export interface SettingsIssue {
  readonly key: string;
  readonly message: string;
}

/** The settings once checked: usable, or the list of what to fix in the installation. */
export type SettingsResult =
  | { readonly ok: true; readonly settings: WidgetSettings }
  | { readonly ok: false; readonly issues: readonly SettingsIssue[] };

/**
 * Checks the raw settings of `getSettings()`. Never throws: an invalid installation gives the list
 * of its issues, so that the widget disables the prepayment actions instead of charging a wrong
 * amount.
 *
 * @param raw - What `getSettings()` resolved with.
 * @returns The typed settings, or the issues by setting key.
 */
export function parseSettings(raw: unknown): SettingsResult {
  const result = settingsSchema.safeParse(raw);
  if (result.success) return { ok: true, settings: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      key: issue.path.length > 0 ? issue.path.join('.') : '(settings)',
      message: issue.message,
    })),
  };
}

/**
 * The checked settings of the installation. Kept in memory only (never persisted): a stale rate
 * would charge a wrong amount. The query fails only when the back office cannot answer
 * `getSettings()` (a `BoError`); invalid values resolve `{ ok: false, issues }`.
 *
 * @returns The TanStack Query result of {@link parseSettings} applied to `getSettings()`.
 */
export function useWidgetSettings(): UseQueryResult<SettingsResult, Error> {
  const bo = useBoClient();
  return useQuery({
    queryKey: queryKeys.settings(),
    queryFn: async () => parseSettings(await bo.getSettings()),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
