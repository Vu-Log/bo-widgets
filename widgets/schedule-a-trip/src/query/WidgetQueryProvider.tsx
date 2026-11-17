import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useBoClient, useBoContext } from '@vulog/bo-widget-react';
import { useMemo, useState, type ReactNode } from 'react';
import { browserStorage, createPersistOptions, createWidgetQueryClient } from './client';

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
    const onError = (operation: string, error: unknown) =>
      bo.log.warn('Query cache: browser storage failed', { operation, error });
    return createPersistOptions({
      fleetId: fleetId ?? NO_FLEET,
      storage: browserStorage(onError),
      onError,
    });
  }, [bo, fleetId]);

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {children}
    </PersistQueryClientProvider>
  );
}
