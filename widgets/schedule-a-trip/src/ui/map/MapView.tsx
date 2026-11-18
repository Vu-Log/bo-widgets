import { Skeleton } from '@mui/material';
import { useBoClient } from '@vulog/bo-widget-react';
import { useCallback, useEffect, useState } from 'react';
import { lazyComponent } from '../lazy';
import { LazyBoundary } from '../LazyBoundary';
import { StaticMap, type MapMarker, type StaticMapProps } from '../StaticMap';
import type { MapFailure } from './failure';
import { hasWebGl } from './webgl';
import { describeError } from '../../query/WidgetQueryProvider';

/** Props of {@link MapView}: those of the static view, and the hover of a vehicle. */
export interface MapViewProps extends StaticMapProps {
  /** Called with the vehicle under the pointer, `null` when it leaves (interactive map only). */
  readonly onMarkerHover?: (id: string | null) => void;
}

const DEFAULT_HEIGHT = 220;

// Mapbox GL JS and its CSS: a chunk of their own, loaded the first time a map is shown.
const MapboxMap = lazyComponent('map', () => import('./MapboxMap').then((module) => module.default));

/** A failure of the map for one token: a new token tries the interactive map again. */
interface TokenFailure {
  readonly token: string;
  readonly failure: MapFailure;
}

/**
 * The tokens Mapbox refused, by client of the back office (one per mounted widget): every later
 * map shows the static view at once, and the refusal is logged once, not at each map.
 */
const refusedTokens = new WeakMap<object, Map<string, MapFailure>>();
const refusedOf = (bo: object): Map<string, MapFailure> => {
  let refused = refusedTokens.get(bo);
  if (!refused) {
    refused = new Map();
    refusedTokens.set(bo, refused);
  }
  return refused;
};

/**
 * The map of the widget (drawer, wizard, vehicle picker): the interactive Mapbox GL JS map, loaded
 * on demand with a skeleton meanwhile, or the static view ({@link StaticMap}, in the main bundle)
 * when it cannot show:
 * - no token in the settings: the static drawing, with the explanation of the token, and Mapbox GL
 *   JS is never loaded;
 * - Mapbox refuses the token (401, 403): the same explanation (the static image would be refused
 *   too), for every later map of the widget with that token, logged once;
 * - no WebGL, the style or the chunk not loaded: the static image of Mapbox.
 *
 * Every failure is logged (`bo.log`).
 *
 * @param props - Token, view, markers and callbacks.
 * @returns The map.
 */
export function MapView(props: MapViewProps) {
  const { token, height = DEFAULT_HEIGHT, onMarkerHover, ...view } = props;
  const bo = useBoClient();
  // Checked before loading the chunk: no need for Mapbox GL JS without WebGL.
  const [webGl] = useState(hasWebGl);
  const [failed, setFailed] = useState<TokenFailure | null>(null);
  const failure = !webGl
    ? NO_WEBGL
    : failed !== null && failed.token === token
      ? failed.failure
      : token === null
        ? null
        : (refusedOf(bo).get(token) ?? null);
  const onFailure = useCallback(
    (next: MapFailure) => {
      if (token === null) return;
      // The first failure of a token is the one shown and logged.
      setFailed((current) => (current?.token === token ? current : { token, failure: next }));
    },
    [token],
  );
  useEffect(() => {
    if (failure === null) return;
    if (failure.kind === 'webgl') {
      bo.log.warn('The interactive map needs WebGL: the static map is shown');
    } else if (failure.kind === 'token') {
      const refused = refusedOf(bo);
      if (token === null || refused.has(token)) return;
      refused.set(token, failure);
      bo.log.error('Mapbox refused the token of the settings', { status: failure.status });
    } else {
      bo.log.error(
        'The interactive map could not be loaded: the static map is shown',
        describeError(failure.error),
      );
    }
  }, [bo, failure, token]);

  if (token === null || failure?.kind === 'token') {
    return <StaticMap {...view} token={null} height={height} />;
  }
  if (failure !== null) return <StaticMap {...view} token={token} height={height} />;
  return (
    <LazyBoundary
      fallback={<Skeleton variant="rounded" height={height} aria-hidden="true" data-lazy-fallback="" />}
      // The chunk could not be loaded (logged by the boundary): the static map instead.
      renderError={() => <StaticMap {...view} token={token} height={height} />}
    >
      <MapboxMap
        token={token}
        center={view.center}
        radiusMeters={view.radiusMeters}
        markers={view.markers ?? NO_MARKERS}
        label={view.label}
        height={height}
        onPick={view.onPick}
        onMarkerClick={view.onMarkerClick}
        onMarkerHover={onMarkerHover}
        onFailure={onFailure}
      />
    </LazyBoundary>
  );
}

const NO_MARKERS: readonly MapMarker[] = [];
const NO_WEBGL: MapFailure = { kind: 'webgl' };
