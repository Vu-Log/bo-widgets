import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  useAuthFetch,
  useBoClient,
  useBoContext,
  useCurrentUser,
} from '@vulog/bo-widget-react';
import { useCallback, useMemo } from 'react';
import { useI18n, type I18n } from '../../i18n';
import { queryKeys } from '../../query/keys';
import { useWidgetSettings, type WidgetSettings } from '../../settings';
import { bookingsCollection, type BookingStateDoc } from '../../storage/booking-state';
import type { MoneyDeps } from './charge';
import { moneyBlocker, type MoneyBlocker } from './messages';

/** What the components of the feature need from the back office. */
export interface PrepaymentEnv {
  readonly i18n: I18n;
  readonly fleetId: string | null;
  /** The currency of the amounts: the setting, else the one of the fleet. */
  readonly currency: string | null;
  /** The dependencies of the workflows; `null` without a fleet or an operator id. */
  readonly deps: MoneyDeps | null;
  /** The valid settings, `null` while loading or when invalid. */
  readonly settings: WidgetSettings | null;
  /** Why the money actions are disabled, `null` when they can run. */
  readonly blocker: MoneyBlocker;
  readonly queryClient: QueryClient;
  /** Puts a written document in the cache (or reads it again), and refreshes the derived data. */
  readonly refresh: (bookingId: string, doc?: BookingStateDoc | null) => Promise<void>;
  /** Formats an amount in {@link currency}, or as a plain number without one. */
  readonly formatAmount: (amount: number) => string;
  /**
   * Runs a workflow of the feature; an error it throws (a bug: the workflows resolve every
   * failure of the API and the storage) is logged to the back office and resolved as
   * `{ ok: false }`, so that a dialog never stays busy.
   */
  readonly guard: <T>(action: string, bookingId: string, task: () => Promise<T>) => Promise<GuardResult<T>>;
  /** Logs the outcome of a money action that is not a plain success, for the support. */
  readonly logOutcome: (action: string, bookingId: string, outcome: { readonly kind: string }) => void;
}

/** What {@link PrepaymentEnv.guard} resolves. */
export type GuardResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

/** Keeps only the kinds and statuses of an outcome for a log: never a customer value. */
const describeOutcome = (outcome: { readonly kind: string }): Record<string, unknown> => {
  const details: Record<string, unknown> = { outcome: outcome.kind };
  for (const key of ['error', 'failure', 'releaseFailure', 'markFailure', 'recordFailure', 'step', 'invoiceId']) {
    const value = (outcome as Record<string, unknown>)[key];
    if (value === null || value === undefined) continue;
    details[key] =
      typeof value === 'object' && 'kind' in value
        ? { kind: (value as { kind: unknown }).kind, status: (value as { status?: unknown }).status }
        : value;
  }
  return details;
};

/**
 * The back office, the settings and the workflow dependencies of the prepayment feature.
 *
 * @returns The environment of the feature.
 */
export function usePrepaymentEnv(): PrepaymentEnv {
  const i18n = useI18n();
  const context = useBoContext();
  const user = useCurrentUser();
  const authFetch = useAuthFetch();
  const bo = useBoClient();
  const queryClient = useQueryClient();
  const settingsQuery = useWidgetSettings();
  const fleetId = context.fleetId;
  const userId = user.id;
  const result = settingsQuery.isError ? null : settingsQuery.data;
  const settings = result?.ok ? result.settings : null;
  const currency = settings?.currency ?? context.currency ?? null;

  const deps = useMemo<MoneyDeps | null>(
    () =>
      fleetId && userId
        ? {
            authFetch,
            fleetId,
            userId,
            collection: bookingsCollection(bo.storage),
            now: () => new Date(),
          }
        : null,
    [authFetch, bo, fleetId, userId],
  );

  const refresh = useCallback(
    async (bookingId: string, doc?: BookingStateDoc | null) => {
      if (!fleetId) return;
      const key = queryKeys.bookingState(fleetId, bookingId);
      if (doc) queryClient.setQueryData(key, doc);
      else await queryClient.invalidateQueries({ queryKey: key });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices(fleetId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.pendingRegularizations(fleetId) }),
      ]);
    },
    [fleetId, queryClient],
  );

  const formatAmount = useCallback(
    (amount: number) =>
      currency ? i18n.formatCurrency(amount, currency) : i18n.formatNumber(amount),
    [currency, i18n],
  );

  const guard = useCallback(
    async <T,>(action: string, bookingId: string, task: () => Promise<T>): Promise<GuardResult<T>> => {
      try {
        return { ok: true, value: await task() };
      } catch (error) {
        bo.log.error(`Prepayment: ${action} failed unexpectedly`, {
          bookingId,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
        return { ok: false };
      }
    },
    [bo],
  );

  const logOutcome = useCallback(
    (action: string, bookingId: string, outcome: { readonly kind: string }) => {
      bo.log.warn(`Prepayment: ${action} ended with ${outcome.kind}`, {
        bookingId,
        ...describeOutcome(outcome),
      });
    },
    [bo],
  );

  return {
    i18n,
    fleetId,
    guard,
    logOutcome,
    currency,
    deps,
    settings,
    blocker: moneyBlocker(result, userId),
    queryClient,
    refresh,
    formatAmount,
  };
}
