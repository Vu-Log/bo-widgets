import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, type Query } from '@tanstack/react-query';
import type { PersistQueryClientOptions, Persister } from '@tanstack/react-query-persist-client';
import { ApiRequestError, isPermanentApiError } from '../api/http';
import { StorageRequestError } from '../storage/booking-state';
import { isPersistedQueryKey } from './keys';

/** Version of the persisted cache: raise it when the shape of a persisted query changes. */
export const CACHE_VERSION = '1';
/** Longest a persisted query is restored after being saved: 24 hours. */
export const PERSIST_MAX_AGE_MS = 24 * 60 * 60_000;
/** Retries of a query that failed for a reason that may pass. */
const MAX_QUERY_RETRIES = 2;

/**
 * Whether a failed query is tried again: never for a storage failure (a rate limit must not be
 * retried in a loop) nor a permanent API failure (4xx, refused or aborted request, unreadable
 * body), at most twice for a 5xx or a network failure.
 *
 * @param failureCount - Failures so far.
 * @param error - The last failure.
 * @returns `true` to retry.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof StorageRequestError) return false;
  if (error instanceof ApiRequestError && isPermanentApiError(error.error)) return false;
  return failureCount < MAX_QUERY_RETRIES;
}

/**
 * The QueryClient of one mounted widget. Mutations are never retried: a write (a charge, a refund)
 * must not run twice.
 *
 * @returns A new client.
 */
export function createWidgetQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetryQuery, refetchOnWindowFocus: true },
      mutations: { retry: 0 },
    },
  });
}

/**
 * The key of the persisted cache in `localStorage`. The widget shares its origin with the back
 * office as a Web Component: the key names the widget, the cache version and the fleet.
 *
 * @param fleetId - The current fleet.
 * @returns The storage key.
 */
export const persistKey = (fleetId: string): string =>
  `schedule-a-trip:query-cache:v${CACHE_VERSION}:${fleetId}`;

/** The synchronous part of `Storage` the persister uses. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Wraps a storage so that its failures (quota, storage disabled) never break the widget: a read
 * that fails is a cache miss, a write that fails is skipped. Each failure is reported.
 *
 * @param storage - `window.localStorage`, or `null` when it is not available.
 * @param onError - Called with each failure, to log it.
 * @returns The wrapped storage, or `null`.
 */
export function safeStorage(
  storage: KeyValueStorage | null,
  onError: (operation: string, error: unknown) => void,
): KeyValueStorage | null {
  if (storage === null) return null;
  return {
    getItem: (key) => {
      try {
        return storage.getItem(key);
      } catch (error) {
        onError('getItem', error);
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        storage.setItem(key, value);
      } catch (error) {
        onError('setItem', error);
      }
    },
    removeItem: (key) => {
      try {
        storage.removeItem(key);
      } catch (error) {
        onError('removeItem', error);
      }
    },
  };
}

/**
 * `window.localStorage`, or `null` when the browser refuses it (blocked site data reject even the
 * access to the property).
 *
 * @param onError - Called when the access fails.
 * @returns The storage, or `null`.
 */
export function browserStorage(
  onError: (operation: string, error: unknown) => void,
): KeyValueStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch (error) {
    onError('localStorage', error);
    return null;
  }
}

/**
 * Only the successful queries of the reference data ({@link isPersistedQueryKey}) are persisted:
 * never a customer, an invoice status, a booking list nor the settings.
 *
 * @param query - A query of the cache.
 * @returns `true` when the query may be written to the browser storage.
 */
export const shouldPersistQuery = (query: Pick<Query, 'queryKey' | 'state'>): boolean =>
  query.state.status === 'success' && isPersistedQueryKey(query.queryKey);

/** What {@link createPersistOptions} needs. */
export interface PersistOptionsInput {
  readonly fleetId: string;
  readonly storage: KeyValueStorage | null;
  readonly onError: (operation: string, error: unknown) => void;
  /** Delay between two saves; 1 second by default. */
  readonly throttleTime?: number;
}

/**
 * The options of `PersistQueryClientProvider`: the reference data of the fleet, in `localStorage`,
 * for {@link PERSIST_MAX_AGE_MS}. Mutations are never persisted.
 *
 * @param input - Fleet, storage, error reporter and throttle.
 * @returns The persist options.
 */
export function createPersistOptions(
  input: PersistOptionsInput,
): Omit<PersistQueryClientOptions, 'queryClient'> {
  const persister: Persister = createAsyncStoragePersister({
    storage: safeStorage(input.storage, input.onError),
    key: persistKey(input.fleetId),
    throttleTime: input.throttleTime ?? 1000,
  });
  return {
    persister,
    maxAge: PERSIST_MAX_AGE_MS,
    buster: CACHE_VERSION,
    dehydrateOptions: {
      shouldDehydrateQuery: shouldPersistQuery,
      shouldDehydrateMutation: () => false,
    },
  };
}
