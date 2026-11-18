import { z } from 'zod';
import type { GeoPoint } from '../domain/vehicles-in-range';
import type { ApiResult } from './http';

/*
 * Mapbox is called with plain `fetch` (never `authFetch`: it is not the Vulog API), with the public
 * token of the settings (`pk.…`), as the back office does for its maps and geocoding.
 */

const MAPBOX_API = 'https://api.mapbox.com';
/** Largest side of a static image, in px (Mapbox limit). */
export const MAX_STATIC_SIZE = 1280;

/** What {@link staticMapUrl} draws. */
export interface StaticMapRequest {
  readonly token: string;
  readonly center: GeoPoint;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
  /** A dark style for the dark theme of the back office. */
  readonly dark: boolean;
}

const clampSize = (value: number): number =>
  Math.min(MAX_STATIC_SIZE, Math.max(1, Math.round(value)));

/**
 * The URL of a Mapbox static image (Static Images API), at twice the density for sharp screens.
 * The widget draws the markers and the radius over it. The image keeps the Mapbox logo and the
 * attribution (© Mapbox, © OpenStreetMap) the API draws by default: the terms of Mapbox require
 * them, never turn them off.
 *
 * @param request - Token, center, zoom, size in px and theme.
 * @returns The image URL.
 */
export function staticMapUrl(request: StaticMapRequest): string {
  const style = request.dark ? 'dark-v11' : 'streets-v12';
  const { longitude, latitude } = request.center;
  const position = `${longitude.toFixed(6)},${latitude.toFixed(6)},${request.zoom}`;
  const size = `${clampSize(request.width)}x${clampSize(request.height)}@2x`;
  const query = new URLSearchParams({ access_token: request.token });
  return `${MAPBOX_API}/styles/v1/mapbox/${style}/static/${position}/${size}?${query}`;
}

const featuresSchema = z.object({
  features: z.array(
    z.object({
      place_name: z.string(),
      center: z.tuple([z.number(), z.number()]),
    }),
  ),
});

/** An address found by the geocoding. */
export interface GeocodedPlace {
  readonly label: string;
  readonly point: GeoPoint;
}

/** `fetch`, injectable for the tests. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const geocode = async (
  path: string,
  params: Record<string, string>,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<ApiResult<readonly GeocodedPlace[]>> => {
  let response: Response;
  try {
    response = await fetcher(`${MAPBOX_API}/geocoding/v5/mapbox.places/${path}.json?${new URLSearchParams(params)}`, {
      signal,
    });
  } catch (error) {
    if (signal?.aborted) return { ok: false, error: { kind: 'aborted' } };
    if (error instanceof TypeError) return { ok: false, error: { kind: 'network', cause: error } };
    throw error;
  }
  if (!response.ok) {
    return {
      ok: false,
      error:
        response.status === 401 || response.status === 403
          ? { kind: 'not-allowed', status: 403 }
          : { kind: 'http', status: response.status },
    };
  }
  let parsed: z.ZodSafeParseResult<z.output<typeof featuresSchema>>;
  try {
    parsed = featuresSchema.safeParse(await response.json());
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { ok: false, error: { kind: 'invalid-response', message: 'not JSON' } };
    }
    throw error;
  }
  if (!parsed.success) {
    return { ok: false, error: { kind: 'invalid-response', message: parsed.error.message } };
  }
  return {
    ok: true,
    data: parsed.data.features.map((feature) => ({
      label: feature.place_name,
      point: { longitude: feature.center[0], latitude: feature.center[1] },
    })),
  };
};

/**
 * The address of a point (reverse geocoding, Mapbox Geocoding v5).
 *
 * @param token - The public Mapbox token.
 * @param point - The point.
 * @param language - Language of the answer (`en`, `fr`…).
 * @param fetcher - `fetch`.
 * @param signal - Aborts the call.
 * @returns The closest address, `null` when there is none, or why the call failed.
 */
export async function reverseGeocode(
  token: string,
  point: GeoPoint,
  language: string,
  fetcher: FetchLike = globalThis.fetch.bind(globalThis),
  signal?: AbortSignal,
): Promise<ApiResult<string | null>> {
  const result = await geocode(
    `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`,
    { access_token: token, language, limit: '1' },
    fetcher,
    signal,
  );
  return result.ok ? { ok: true, data: result.data[0]?.label ?? null } : result;
}

/**
 * The addresses matching a text (forward geocoding, Mapbox Geocoding v5), closest to a point first
 * when one is given.
 *
 * @param token - The public Mapbox token.
 * @param query - What the operator typed.
 * @param language - Language of the answer.
 * @param proximity - A point to favour, such as the current pickup point.
 * @param fetcher - `fetch`.
 * @param signal - Aborts the call.
 * @returns Up to 5 addresses, or why the call failed.
 */
export async function forwardGeocode(
  token: string,
  query: string,
  language: string,
  proximity: GeoPoint | null,
  fetcher: FetchLike = globalThis.fetch.bind(globalThis),
  signal?: AbortSignal,
): Promise<ApiResult<readonly GeocodedPlace[]>> {
  const text = query.trim();
  if (text === '') return { ok: true, data: [] };
  const params: Record<string, string> = { access_token: token, language, limit: '5' };
  if (proximity) params.proximity = `${proximity.longitude},${proximity.latitude}`;
  return geocode(encodeURIComponent(text), params, fetcher, signal);
}
