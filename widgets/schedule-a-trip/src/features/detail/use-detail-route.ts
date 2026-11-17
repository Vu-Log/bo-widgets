import { useBoClient, useBoRouter } from '@vulog/bo-widget-react';
import { useCallback, useEffect, useState } from 'react';

/**
 * The booking id of a route of the widget: the first segment after its view (`{basename}/{id}`).
 *
 * @param pathname - The path of the back office route.
 * @param basename - The path of the widget's view.
 * @returns The id, decoded, or `null` on the view itself or outside it.
 */
export function bookingIdFromPath(pathname: string, basename: string): string | null {
  const base = basename.replace(/\/+$/, '');
  if (base !== '' && pathname !== base && !pathname.startsWith(`${base}/`)) return null;
  const segment = pathname.slice(base.length).split('/').find(Boolean);
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

/** The booking open in the detail drawer, and how to change it. */
export interface DetailRoute {
  readonly selectedId: string | null;
  readonly open: (bookingId: string) => void;
  readonly close: () => void;
}

/**
 * The booking of the detail drawer, kept in the URL (`{view}/{bookingId}`): a deep link or a reload
 * opens it, the back button closes it. The drawer follows the click at once; the route follows
 * through `navigate` of the back office, then `routeChanged`.
 *
 * @returns The id of the open booking, and `open` and `close`.
 */
export function useDetailRoute(): DetailRoute {
  const { basename, location, navigate } = useBoRouter();
  const bo = useBoClient();
  const fromRoute = location === null ? null : bookingIdFromPath(location.pathname, basename);
  const [selectedId, setSelectedId] = useState<string | null>(fromRoute);

  useEffect(() => {
    if (location !== null) setSelectedId(fromRoute);
  }, [location, fromRoute]);

  const go = useCallback(
    (path: string) =>
      void navigate(path).catch((error: unknown) =>
        bo.log.warn('The route of the detail could not be updated', {
          path,
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
    [navigate, bo],
  );
  const open = useCallback(
    (bookingId: string) => {
      setSelectedId(bookingId);
      go(encodeURIComponent(bookingId));
    },
    [go],
  );
  const close = useCallback(() => {
    setSelectedId(null);
    go('.');
  }, [go]);
  return { selectedId, open, close };
}
