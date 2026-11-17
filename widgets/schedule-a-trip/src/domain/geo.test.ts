import { describe, expect, it } from 'vitest';
import {
  fitZoom,
  fromViewPixel,
  MAX_ZOOM,
  metersPerPixel,
  MIN_ZOOM,
  TILE_SIZE,
  toViewPixel,
  worldPixel,
} from './geo';

const center = { latitude: 48.8566, longitude: 2.3522 };

describe('worldPixel', () => {
  it('puts the origin of the coordinates in the middle of the world', () => {
    expect(worldPixel({ latitude: 0, longitude: 0 }, 0)).toEqual({
      x: TILE_SIZE / 2,
      y: TILE_SIZE / 2,
    });
  });

  it('clamps the poles instead of giving an infinite pixel', () => {
    const pole = worldPixel({ latitude: 90, longitude: 0 }, 0);
    expect(Number.isFinite(pole.y)).toBe(true);
    expect(pole.y).toBeLessThan(1);
  });
});

describe('toViewPixel and fromViewPixel', () => {
  const view = { center, zoom: 14, width: 400, height: 220 };

  it('puts the center in the middle of the map', () => {
    expect(toViewPixel(center, view)).toEqual({ x: 200, y: 110 });
  });

  it('are the inverse of each other', () => {
    const point = { latitude: 48.86, longitude: 2.36 };
    const back = fromViewPixel(toViewPixel(point, view), view);
    expect(back.latitude).toBeCloseTo(point.latitude, 8);
    expect(back.longitude).toBeCloseTo(point.longitude, 8);
  });

  it('puts a point east of the center on the right, north above', () => {
    const east = toViewPixel({ ...center, longitude: center.longitude + 0.01 }, view);
    const north = toViewPixel({ ...center, latitude: center.latitude + 0.01 }, view);
    expect(east.x).toBeGreaterThan(200);
    expect(north.y).toBeLessThan(110);
  });
});

describe('metersPerPixel', () => {
  it('halves at each zoom level and shrinks with the latitude', () => {
    expect(metersPerPixel(0, 1)).toBeCloseTo(metersPerPixel(0, 0) / 2, 6);
    expect(metersPerPixel(60, 10)).toBeCloseTo(metersPerPixel(0, 10) / 2, 6);
  });
});

describe('fitZoom', () => {
  it('fits a small radius at a close zoom and a large one further away', () => {
    const small = fitZoom({ center, radiusMeters: 200, points: [], width: 400, height: 220 });
    const large = fitZoom({ center, radiusMeters: 5000, points: [], width: 400, height: 220 });
    expect(small).toBeGreaterThan(large);
    expect(small).toBeLessThanOrEqual(MAX_ZOOM);
  });

  it('zooms out to keep every point in view', () => {
    const alone = fitZoom({ center, radiusMeters: 200, points: [], width: 400, height: 220 });
    const withFar = fitZoom({
      center,
      radiusMeters: 200,
      points: [{ latitude: 48.95, longitude: 2.5 }],
      width: 400,
      height: 220,
    });
    expect(withFar).toBeLessThan(alone);
  });

  it('falls back to the widest zoom when nothing fits', () => {
    expect(fitZoom({ center, radiusMeters: 1e9, points: [], width: 400, height: 220 })).toBe(
      MIN_ZOOM,
    );
  });

  it('reads a negative radius as none', () => {
    expect(fitZoom({ center, radiusMeters: -5, points: [], width: 400, height: 220 })).toBe(
      MAX_ZOOM,
    );
  });
});
