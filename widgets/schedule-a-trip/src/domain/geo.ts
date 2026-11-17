import type { GeoPoint } from './vehicles-in-range';

/** Size in px of a tile of the Mapbox styles: the world is `TILE_SIZE × 2^zoom` px wide. */
export const TILE_SIZE = 512;
/** Equatorial circumference of the Earth, in meters (Web Mercator). */
const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;
const MAX_SIN_LATITUDE = 0.9999;

/** A point in px. */
export interface Pixel {
  readonly x: number;
  readonly y: number;
}

/** What a map shows: its center, zoom and size in px. */
export interface MapView {
  readonly center: GeoPoint;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
}

const worldSize = (zoom: number): number => TILE_SIZE * 2 ** zoom;

/**
 * The position of a point on the Web Mercator world at a zoom, in px from its top left corner.
 *
 * @param point - A point.
 * @param zoom - The zoom level.
 * @returns Its pixel on the world.
 */
export function worldPixel(point: GeoPoint, zoom: number): Pixel {
  const size = worldSize(zoom);
  const sin = Math.min(
    Math.max(Math.sin((point.latitude * Math.PI) / 180), -MAX_SIN_LATITUDE),
    MAX_SIN_LATITUDE,
  );
  return {
    x: ((point.longitude + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

/**
 * The position of a point on a map, in px from its top left corner (outside the map when the point
 * is not in view).
 *
 * @param point - A point.
 * @param view - The map.
 * @returns Its pixel on the map.
 */
export function toViewPixel(point: GeoPoint, view: MapView): Pixel {
  const target = worldPixel(point, view.zoom);
  const center = worldPixel(view.center, view.zoom);
  return { x: target.x - center.x + view.width / 2, y: target.y - center.y + view.height / 2 };
}

/**
 * The point under a pixel of a map: the inverse of {@link toViewPixel}.
 *
 * @param pixel - A pixel of the map.
 * @param view - The map.
 * @returns The point.
 */
export function fromViewPixel(pixel: Pixel, view: MapView): GeoPoint {
  const center = worldPixel(view.center, view.zoom);
  const size = worldSize(view.zoom);
  const x = center.x + pixel.x - view.width / 2;
  const y = center.y + pixel.y - view.height / 2;
  const longitude = (x / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / size;
  const latitude = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { latitude, longitude };
}

/**
 * The ground distance one px covers at a latitude and a zoom.
 *
 * @param latitude - The latitude, in degrees.
 * @param zoom - The zoom level.
 * @returns Meters per px.
 */
export const metersPerPixel = (latitude: number, zoom: number): number =>
  (EARTH_CIRCUMFERENCE_METERS * Math.cos((latitude * Math.PI) / 180)) / worldSize(zoom);

/** Zooms {@link fitZoom} picks from. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 17;

/**
 * The closest integer zoom at which a circle around the center and every point fit in a map, with a
 * margin. Falls back to {@link MIN_ZOOM} when nothing fits.
 *
 * @param input - Center, radius of the circle (m), points, map size and margin (px, 24 by default).
 * @returns The zoom.
 */
export function fitZoom(input: {
  readonly center: GeoPoint;
  readonly radiusMeters: number;
  readonly points: readonly GeoPoint[];
  readonly width: number;
  readonly height: number;
  readonly margin?: number;
}): number {
  const margin = input.margin ?? 24;
  const halfWidth = input.width / 2 - margin;
  const halfHeight = input.height / 2 - margin;
  for (let zoom = MAX_ZOOM; zoom > MIN_ZOOM; zoom--) {
    const view = { center: input.center, zoom, width: input.width, height: input.height };
    const radiusPx = Math.max(0, input.radiusMeters) / metersPerPixel(input.center.latitude, zoom);
    if (radiusPx > Math.min(halfWidth, halfHeight)) continue;
    const fits = input.points.every((point) => {
      const pixel = toViewPixel(point, view);
      return (
        Math.abs(pixel.x - input.width / 2) <= halfWidth &&
        Math.abs(pixel.y - input.height / 2) <= halfHeight
      );
    });
    if (fits) return zoom;
  }
  return MIN_ZOOM;
}

const EARTH_RADIUS_METERS = 6_371_008.8;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/**
 * A circle on the ground as a closed ring of points (great-circle destinations), to draw a radius
 * on a map library.
 *
 * @param center - The center.
 * @param radiusMeters - The radius in meters.
 * @param steps - The number of distinct points of the ring, 64 by default.
 * @returns `steps + 1` positions `[longitude, latitude]`, the last one equal to the first.
 * @throws {RangeError} When the radius is negative or not finite, or `steps` is below 3.
 */
export function circleRing(center: GeoPoint, radiusMeters: number, steps = 64): [number, number][] {
  if (!Number.isFinite(radiusMeters) || radiusMeters < 0) {
    throw new RangeError(`Invalid radius: ${radiusMeters}`);
  }
  if (!Number.isInteger(steps) || steps < 3) throw new RangeError(`Invalid number of steps: ${steps}`);
  const angular = radiusMeters / EARTH_RADIUS_METERS;
  const latitude = toRadians(center.latitude);
  const longitude = toRadians(center.longitude);
  const ring: [number, number][] = [];
  for (let step = 0; step < steps; step++) {
    const bearing = (2 * Math.PI * step) / steps;
    const lat = Math.asin(
      Math.sin(latitude) * Math.cos(angular) +
        Math.cos(latitude) * Math.sin(angular) * Math.cos(bearing),
    );
    const lon =
      longitude +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(latitude),
        Math.cos(angular) - Math.sin(latitude) * Math.sin(lat),
      );
    ring.push([toDegrees(lon), toDegrees(lat)]);
  }
  const first = ring[0] ?? [center.longitude, center.latitude];
  ring.push([first[0], first[1]]);
  return ring;
}

/**
 * The bounding box of positions.
 *
 * @param positions - Positions `[longitude, latitude]`.
 * @returns `[[west, south], [east, north]]`, `null` without position.
 */
export function boundsOf(
  positions: readonly (readonly [number, number])[],
): [[number, number], [number, number]] | null {
  if (positions.length === 0) return null;
  const longitudes = positions.map(([lon]) => lon);
  const latitudes = positions.map(([, lat]) => lat);
  return [
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  ];
}
