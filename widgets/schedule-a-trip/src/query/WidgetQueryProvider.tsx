import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useBoClient, useBoContext } from '@vulog/bo-widget-react';
import { useMemo, useState, type ReactNode } from 'react';
import { browserStorage, createPersistOptions, createWidgetQueryClient } from './client';

/**
 * The name and message of an error, for a log.
 *
 * @param error - What was thrown.
 * @returns `{ name, message }`.
 */
export const describeError = (error: unknown): { name: string; message: string } =>
  error instanceof Error || error instanceof DOMException
    ? { name: error.name, message: error.message }
    : { name: typeof error, message: String(error) };

/** Fleet of the cache when the back office gives none. */
const NO_FLEET = 'no-fleet';

/**
 * Gives the widget its QueryClient, created once per mount, and persists the reference data of
 * the current fleet in `localStorage` (never personal data nor payment statuses). A failure of the
 * browser storage is logged to the back office and the widget goes on without the cache.
 *
 * @param props - The widget.
 * @returns The provider.
 */
export function WidgetQueryProvider({ children }: { readonly children: ReactNode }) {
  const bo = useBoClient();
  const { fleetId } = useBoContext();
  const [queryClient] = useState(createWidgetQueryClient);
  const persistOptions = useMemo(() => {
    // A DOMException (QuotaExceededError…) is not serialized by the log: keep its name and message.
    const onError = (operation: string, error: unknown) =>
      bo.log.warn('Query cache: browser storage failed', { operation, ...describeError(error) });
    return createPersistOptions({
      fleetId: fleetId ?? NO_FLEET,
      storage: browserStorage(onError),
      onError,
    });
  }, [bo, fleetId]);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
      onError={() =>
        bo.log.warn('Query cache: the saved cache could not be restored; it was dropped')
      }
    >
      {children}
    </PersistQueryClientProvider>
  );
}
