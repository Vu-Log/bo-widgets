import { Box, IconButton, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { staticMapUrl } from '../api/mapbox';
import { fitZoom, fromViewPixel, MAX_ZOOM, metersPerPixel, MIN_ZOOM, toViewPixel } from '../domain/geo';
import type { GeoPoint } from '../domain/vehicles-in-range';
import { useI18n } from '../i18n';

/** A point drawn on a {@link StaticMap}. */
export interface MapMarker {
  readonly id: string;
  readonly point: GeoPoint;
  /** `ok`: in range; `muted`: out of range. */
  readonly tone: 'ok' | 'muted';
  readonly highlighted?: boolean;
  /** Shown on hover and read by screen readers. */
  readonly label: string;
}

/** Props of {@link StaticMap}. */
export interface StaticMapProps {
  /** Public Mapbox token; without one, only the drawing shows, on a plain background. */
  readonly token: string | null;
  readonly center: GeoPoint;
  /** Radius drawn around the center, in meters; none when `null`. */
  readonly radiusMeters: number | null;
  readonly markers?: readonly MapMarker[];
  /** Accessible description of the map. */
  readonly label: string;
  /** Height in px, 220 by default. The width follows the container. */
  readonly height?: number;
  /** Makes the map clickable: called with the point clicked. */
  readonly onPick?: (point: GeoPoint) => void;
  readonly onMarkerClick?: (id: string) => void;
}

const DEFAULT_WIDTH = 400;

/** The width of an element, following its resizes; {@link DEFAULT_WIDTH} until measured. */
function useWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    if (element === null) return undefined;
    const measure = () => {
      if (element.clientWidth > 0) setWidth(element.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
}

/**
 * A map of a pickup point: a Mapbox static image (Static Images API), with the radius, the pickup
 * point and markers drawn over it in SVG, at the zoom that fits them, with zoom buttons. No map
 * library: nothing to load, no WebGL, and no style outside the shadow root. When the image cannot
 * load (no token, network), the drawing stays, on a plain background, with a message.
 *
 * @param props - Token, center, radius, markers and callbacks.
 * @returns The map.
 */
export function StaticMap({
  token,
  center,
  radiusMeters,
  markers = [],
  label,
  height = 220,
  onPick,
  onMarkerClick,
}: StaticMapProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const width = useWidth(container);
  const [zoomOffset, setZoomOffset] = useState(0);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const fittedZoom = useMemo(
    () =>
      fitZoom({
        center,
        radiusMeters: radiusMeters ?? 0,
        points: markers.map((marker) => marker.point),
        width,
        height,
      }),
    [center, radiusMeters, markers, width, height],
  );
  useEffect(() => setZoomOffset(0), [center.latitude, center.longitude, radiusMeters]);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fittedZoom + zoomOffset));
  const view = { center, zoom, width, height };
  const url =
    token === null
      ? null
      : staticMapUrl({ token, center, zoom, width, height, dark: theme.palette.mode === 'dark' });
  const imageShown = url !== null && failedUrl !== url;
  const radiusPx = radiusMeters === null ? 0 : radiusMeters / metersPerPixel(center.latitude, zoom);
  const middle = { x: width / 2, y: height / 2 };

  const pick = (event: MouseEvent<SVGSVGElement>) => {
    if (!onPick) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onPick(fromViewPixel({ x: event.clientX - rect.left, y: event.clientY - rect.top }, view));
  };

  return (
    <Box
      ref={setContainer}
      sx={{
        position: 'relative',
        height,
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: 'action.hover',
        border: 1,
        borderColor: 'divider',
      }}
    >
      {imageShown && (
        <img
          src={url}
          alt=""
          width={width}
          height={height}
          onError={() => setFailedUrl(url)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
      <svg
        role="img"
        aria-label={label}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onClick={pick}
        style={{ position: 'absolute', inset: 0, cursor: onPick ? 'crosshair' : 'default' }}
      >
        {radiusPx > 0 && (
          <circle
            cx={middle.x}
            cy={middle.y}
            r={radiusPx}
            fill={theme.palette.primary.main}
            fillOpacity={0.12}
            stroke={theme.palette.primary.main}
            strokeDasharray="4 3"
            data-radius=""
          />
        )}
        {markers.map((marker) => {
          const pixel = toViewPixel(marker.point, view);
          return (
            <circle
              key={marker.id}
              data-marker={marker.id}
              cx={pixel.x}
              cy={pixel.y}
              r={marker.highlighted ? 8 : 6}
              fill={marker.tone === 'ok' ? theme.palette.success.main : theme.palette.text.disabled}
              stroke={theme.palette.background.paper}
              strokeWidth={2}
              style={{ cursor: onMarkerClick ? 'pointer' : 'default' }}
              onClick={(event) => {
                if (!onMarkerClick) return;
                event.stopPropagation();
                onMarkerClick(marker.id);
              }}
            >
              <title>{marker.label}</title>
            </circle>
          );
        })}
        <path
          d={`M${middle.x} ${middle.y} l-9 -16 a10 10 0 1 1 18 0 z`}
          fill={theme.palette.primary.main}
          data-center=""
        />
        <circle cx={middle.x} cy={middle.y - 22} r={4} fill={theme.palette.background.paper} />
      </svg>
      {!imageShown && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ position: 'absolute', left: 8, bottom: 4 }}
        >
          {token === null ? t('map.noToken') : t('map.unavailable')}
        </Typography>
      )}
      <Box sx={{ position: 'absolute', right: 4, top: 4, display: 'grid', gap: 0.5 }}>
        <IconButton
          size="small"
          aria-label={t('map.zoomIn')}
          disabled={zoom >= MAX_ZOOM}
          onClick={() => setZoomOffset((offset) => offset + 1)}
          sx={{ bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}
        >
          +
        </IconButton>
        <IconButton
          size="small"
          aria-label={t('map.zoomOut')}
          disabled={zoom <= MIN_ZOOM}
          onClick={() => setZoomOffset((offset) => offset - 1)}
          sx={{ bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}
        >
          −
        </IconButton>
      </Box>
    </Box>
  );
}
