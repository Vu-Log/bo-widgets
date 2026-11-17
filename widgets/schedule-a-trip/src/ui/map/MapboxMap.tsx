import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useBoClient } from '@vulog/bo-widget-react';
import mapboxgl from 'mapbox-gl';
import mapboxCss from 'mapbox-gl/dist/mapbox-gl.css?inline';
import { useEffect, useMemo, useRef, useState } from 'react';
import { boundsOf, circleRing } from '../../domain/geo';
import type { GeoPoint } from '../../domain/vehicles-in-range';
import type { MapMarker } from '../StaticMap';
import type { MapFailure } from './failure';

/** Props of {@link MapboxMap}. */
export interface MapboxMapProps {
  /** Public Mapbox token of the installation. */
  readonly token: string;
  readonly center: GeoPoint;
  readonly radiusMeters: number | null;
  readonly markers: readonly MapMarker[];
  readonly label: string;
  readonly height: number;
  readonly onPick?: (point: GeoPoint) => void;
  readonly onMarkerClick?: (id: string) => void;
  readonly onMarkerHover?: (id: string | null) => void;
  /** The map cannot be shown (no WebGL, token refused, style not loaded): show the fallback. */
  readonly onFailure: (failure: MapFailure) => void;
}

const STYLE_ATTRIBUTE = 'data-mapbox-gl-css';
const RADIUS_SOURCE = 'pickup-radius';
const VEHICLE_SOURCE = 'vehicles';
const VEHICLE_LAYER = 'vehicles';
const CLUSTER_LAYER = 'vehicle-clusters';
const CLUSTER_COUNT_LAYER = 'vehicle-cluster-count';
const FIT_PADDING = 32;
const MAX_FIT_ZOOM = 16;

/**
 * Adds the CSS of Mapbox GL JS to the shadow root of the widget, once: never to `document.head`.
 * Outside a shadow root (tests), the style goes next to the map.
 *
 * @param container - The element of the map.
 */
export function injectMapboxCss(container: HTMLElement): void {
  const root = container.getRootNode();
  const target = root instanceof ShadowRoot ? root : container.parentElement;
  if (!target || target.querySelector(`style[${STYLE_ATTRIBUTE}]`)) return;
  const style = document.createElement('style');
  style.setAttribute(STYLE_ATTRIBUTE, '');
  style.textContent = mapboxCss;
  target.prepend(style);
}

/** The status of an error event of Mapbox GL JS, when it comes from an HTTP answer. */
const statusOf = (error: unknown): number | null => {
  if (typeof error !== 'object' || error === null || !('status' in error)) return null;
  return typeof error.status === 'number' ? error.status : null;
};

/** The vehicles as a GeoJSON collection, with what the layers read. */
const vehicleData = (markers: readonly MapMarker[]): GeoJSON.FeatureCollection<GeoJSON.Point> => ({
  type: 'FeatureCollection',
  features: markers.map((marker) => ({
    type: 'Feature',
    properties: {
      id: marker.id,
      label: marker.label,
      inRange: marker.tone === 'ok',
      highlighted: marker.highlighted === true,
    },
    geometry: { type: 'Point', coordinates: [marker.point.longitude, marker.point.latitude] },
  })),
});

const radiusData = (center: GeoPoint, radiusMeters: number | null): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features:
    radiusMeters === null || radiusMeters <= 0
      ? []
      : [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [circleRing(center, radiusMeters)] },
          },
        ],
});

/**
 * An interactive map of Mapbox GL JS: the pickup point (a marker that can be dragged, and a click
 * moves it, when `onPick` is given), its radius, and the vehicles, clustered when they overlap, in
 * range or not, the hovered one highlighted, synced with the list. It fits the radius and the
 * vehicles, follows the size of its container and is removed on unmount. The Mapbox logo and the
 * attribution stay visible. In the lazy map chunk: it and its CSS are loaded only when a map is
 * shown.
 *
 * When Mapbox refuses the token (401, 403: wrong token, or a URL the token is not restricted to),
 * when the map cannot be created or its style cannot be loaded, it calls `onFailure`: `MapView`
 * then shows the static view. `MapView` checks WebGL before loading this chunk.
 *
 * @param props - Token, view, vehicles and callbacks.
 * @returns The map.
 */
export default function MapboxMap(props: MapboxMapProps) {
  const { token, center, radiusMeters, markers, label, height } = props;
  const theme = useTheme();
  const bo = useBoClient();
  const dark = theme.palette.mode === 'dark';
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const pinRef = useRef<mapboxgl.Marker | null>(null);
  const [ready, setReady] = useState(false);
  // The latest props, for the handlers registered once per map.
  const latest = useRef(props);
  latest.current = props;
  const primary = theme.palette.primary.main;
  const ok = theme.palette.success.main;
  const muted = theme.palette.text.disabled;
  const outline = theme.palette.background.paper;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    injectMapboxCss(container);
    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container,
        accessToken: token,
        style: dark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12',
        center: [latest.current.center.longitude, latest.current.center.latitude],
        zoom: 13,
        attributionControl: true,
        logoPosition: 'bottom-left',
      });
    } catch (error) {
      latest.current.onFailure({ kind: 'load', error });
      return undefined;
    }
    mapRef.current = map;
    let loaded = false;
    let warned = false;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('error', (event) => {
      const status = statusOf(event.error);
      if (status === 401 || status === 403) {
        latest.current.onFailure({ kind: 'token', status });
      } else if (!loaded) {
        latest.current.onFailure({ kind: 'load', error: event.error });
      } else if (!warned) {
        // A tile or an image that failed after the map showed: the map stays, logged once.
        warned = true;
        bo.log.warn('The map could not load a resource', {
          status,
          message: event.error instanceof Error ? event.error.message : String(event.error),
        });
      }
    });
    map.on('load', () => {
      loaded = true;
      map.addSource(RADIUS_SOURCE, { type: 'geojson', data: radiusData(latest.current.center, latest.current.radiusMeters) });
      map.addLayer({
        id: `${RADIUS_SOURCE}-fill`,
        type: 'fill',
        source: RADIUS_SOURCE,
        paint: { 'fill-color': primary, 'fill-opacity': 0.12 },
      });
      map.addLayer({
        id: `${RADIUS_SOURCE}-line`,
        type: 'line',
        source: RADIUS_SOURCE,
        paint: { 'line-color': primary, 'line-width': 1.5, 'line-dasharray': [2, 1.5] },
      });
      map.addSource(VEHICLE_SOURCE, {
        type: 'geojson',
        data: vehicleData(latest.current.markers),
        cluster: true,
        clusterRadius: 32,
        clusterMaxZoom: 15,
      });
      map.addLayer({
        id: CLUSTER_LAYER,
        type: 'circle',
        source: VEHICLE_SOURCE,
        filter: ['has', 'point_count'],
        paint: { 'circle-color': muted, 'circle-radius': 14, 'circle-stroke-color': outline, 'circle-stroke-width': 2 },
      });
      map.addLayer({
        id: CLUSTER_COUNT_LAYER,
        type: 'symbol',
        source: VEHICLE_SOURCE,
        filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 },
        paint: { 'text-color': outline },
      });
      map.addLayer({
        id: VEHICLE_LAYER,
        type: 'circle',
        source: VEHICLE_SOURCE,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['case', ['get', 'inRange'], ok, muted],
          'circle-radius': ['case', ['get', 'highlighted'], 9, 6],
          'circle-stroke-color': outline,
          'circle-stroke-width': 2,
        },
      });
      setReady(true);
    });
    map.on('click', VEHICLE_LAYER, (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === 'string') latest.current.onMarkerClick?.(id);
    });
    map.on('mouseenter', VEHICLE_LAYER, (event) => {
      map.getCanvas().style.cursor = 'pointer';
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === 'string') latest.current.onMarkerHover?.(id);
    });
    map.on('mouseleave', VEHICLE_LAYER, () => {
      map.getCanvas().style.cursor = '';
      latest.current.onMarkerHover?.(null);
    });
    map.on('click', CLUSTER_LAYER, (event) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      const source = map.getSource<mapboxgl.GeoJSONSource>(VEHICLE_SOURCE);
      if (typeof clusterId !== 'number' || !source || feature?.geometry.type !== 'Point') return;
      const [longitude = 0, latitude = 0] = feature.geometry.coordinates;
      source.getClusterExpansionZoom(clusterId, (error, zoom) => {
        if (error || typeof zoom !== 'number') return;
        map.easeTo({ center: [longitude, latitude], zoom });
      });
    });
    map.on('click', (event) => {
      const pick = latest.current.onPick;
      if (!pick) return;
      // A click on a vehicle or a cluster is not a new pickup point.
      const hits = map.queryRenderedFeatures(event.point, { layers: [VEHICLE_LAYER, CLUSTER_LAYER] });
      if (hits.length > 0) return;
      pick({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
    });
    const pin = new mapboxgl.Marker({ color: primary, draggable: latest.current.onPick !== undefined })
      .setLngLat([latest.current.center.longitude, latest.current.center.latitude])
      .addTo(map);
    pin.on('dragend', () => {
      const position = pin.getLngLat();
      latest.current.onPick?.({ latitude: position.lat, longitude: position.lng });
    });
    pinRef.current = pin;
    // Mapbox follows the window, not its container (a dialog that opens, a drawer).
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => map.resize());
    observer?.observe(container);
    return () => {
      observer?.disconnect();
      pin.remove();
      map.remove();
      mapRef.current = null;
      pinRef.current = null;
      setReady(false);
    };
    // The map is built again for a new token or theme only; the rest follows in the effects below.
  }, [token, dark, bo, primary, ok, muted, outline]);

  // The pickup point and its radius.
  useEffect(() => {
    pinRef.current?.setLngLat([center.longitude, center.latitude]);
    if (!ready) return;
    mapRef.current
      ?.getSource<mapboxgl.GeoJSONSource>(RADIUS_SOURCE)
      ?.setData(radiusData(center, radiusMeters));
  }, [ready, center, radiusMeters]);

  // The vehicles: their data follows every change (the highlighted one), the view only a new set.
  useEffect(() => {
    if (!ready) return;
    mapRef.current?.getSource<mapboxgl.GeoJSONSource>(VEHICLE_SOURCE)?.setData(vehicleData(markers));
  }, [ready, markers]);
  const fitKey = useMemo(
    () =>
      JSON.stringify([
        center.latitude,
        center.longitude,
        radiusMeters,
        markers.map((marker) => [marker.id, marker.point.latitude, marker.point.longitude]),
      ]),
    [center, radiusMeters, markers],
  );
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const { center: fitCenter, radiusMeters: fitRadius, markers: fitMarkers } = latest.current;
    const positions: [number, number][] = [
      ...(fitRadius && fitRadius > 0 ? circleRing(fitCenter, fitRadius, 16) : []),
      [fitCenter.longitude, fitCenter.latitude],
      ...fitMarkers.map((marker): [number, number] => [marker.point.longitude, marker.point.latitude]),
    ];
    const bounds = boundsOf(positions);
    if (bounds) map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM, animate: false });
  }, [ready, fitKey]);

  return (
    <Box
      role="region"
      aria-label={label}
      sx={{ position: 'relative', height, borderRadius: 1, overflow: 'hidden', border: 1, borderColor: 'divider' }}
    >
      <Box ref={containerRef} data-mapbox-map="" sx={{ position: 'absolute', inset: 0 }} />
    </Box>
  );
}
