import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../test/fake-bo';
import { forwardGeocode, reverseGeocode, staticMapUrl, type FetchLike } from './mapbox';

const point = { latitude: 48.8566, longitude: 2.3522 };
const answer = {
  features: [{ place_name: '1 Example Street, Example City', center: [2.35, 48.85], extra: 1 }],
};

describe('staticMapUrl', () => {
  it('builds the URL of a static image at double density', () => {
    const url = new URL(
      staticMapUrl({ token: 'pk.test', center: point, zoom: 14, width: 400.4, height: 220, dark: false }),
    );
    expect(url.origin).toBe('https://api.mapbox.com');
    expect(url.pathname).toBe('/styles/v1/mapbox/streets-v12/static/2.352200,48.856600,14/400x220@2x');
    expect(url.searchParams.get('access_token')).toBe('pk.test');
  });

  it('uses a dark style and keeps the size within the limits', () => {
    const url = staticMapUrl({ token: 'pk.t', center: point, zoom: 3, width: 5000, height: 0, dark: true });
    expect(url).toContain('/dark-v11/static/');
    expect(url).toContain('/1280x1@2x?');
  });
});

describe('reverseGeocode', () => {
  it('gives the closest address', async () => {
    const fetcher = vi.fn<FetchLike>(async () => jsonResponse(answer));
    expect(await reverseGeocode('pk.t', point, 'fr', fetcher)).toEqual({
      ok: true,
      data: '1 Example Street, Example City',
    });
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.pathname).toBe('/geocoding/v5/mapbox.places/2.352200,48.856600.json');
    expect(url.searchParams.get('language')).toBe('fr');
  });

  it('gives null when nothing is found', async () => {
    const fetcher = vi.fn<FetchLike>(async () => jsonResponse({ features: [] }));
    expect(await reverseGeocode('pk.t', point, 'en', fetcher)).toEqual({ ok: true, data: null });
  });

  it('maps a refused token to not-allowed', async () => {
    const fetcher = vi.fn<FetchLike>(async () => new Response('', { status: 401 }));
    expect(await reverseGeocode('pk.t', point, 'en', fetcher)).toEqual({
      ok: false,
      error: { kind: 'not-allowed', status: 403 },
    });
  });

  it('maps a network failure, an abort and an unreadable answer', async () => {
    const offline = vi.fn<FetchLike>(async () => Promise.reject(new TypeError('offline')));
    const offlineResult = await reverseGeocode('pk.t', point, 'en', offline);
    expect(offlineResult.ok ? null : offlineResult.error.kind).toBe('network');

    const controller = new AbortController();
    controller.abort();
    const aborted = vi.fn<FetchLike>(async () => Promise.reject(new DOMException('', 'AbortError')));
    const abortedResult = await reverseGeocode('pk.t', point, 'en', aborted, controller.signal);
    expect(abortedResult.ok ? null : abortedResult.error.kind).toBe('aborted');

    const garbage = vi.fn<FetchLike>(async () => new Response('<html>', { status: 200 }));
    const garbageResult = await reverseGeocode('pk.t', point, 'en', garbage);
    expect(garbageResult.ok ? null : garbageResult.error.kind).toBe('invalid-response');

    const wrongShape = vi.fn<FetchLike>(async () => jsonResponse({ features: 'no' }));
    const wrongResult = await reverseGeocode('pk.t', point, 'en', wrongShape);
    expect(wrongResult.ok ? null : wrongResult.error.kind).toBe('invalid-response');
  });

  it('maps another failure status', async () => {
    const fetcher = vi.fn<FetchLike>(async () => new Response('', { status: 429 }));
    expect(await reverseGeocode('pk.t', point, 'en', fetcher)).toEqual({
      ok: false,
      error: { kind: 'http', status: 429 },
    });
  });
});

describe('forwardGeocode', () => {
  it('searches a text near a point', async () => {
    const fetcher = vi.fn<FetchLike>(async () => jsonResponse(answer));
    const result = await forwardGeocode('pk.t', ' 1 Example / Street ', 'en', point, fetcher);
    expect(result).toEqual({
      ok: true,
      data: [{ label: '1 Example Street, Example City', point: { latitude: 48.85, longitude: 2.35 } }],
    });
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.pathname).toBe('/geocoding/v5/mapbox.places/1%20Example%20%2F%20Street.json');
    expect(url.searchParams.get('proximity')).toBe('2.3522,48.8566');
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('does not call for a blank text', async () => {
    const fetcher = vi.fn<FetchLike>();
    expect(await forwardGeocode('pk.t', '  ', 'en', null, fetcher)).toEqual({ ok: true, data: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps a failure', async () => {
    const fetcher = vi.fn<FetchLike>(async () => new Response('', { status: 500 }));
    const result = await forwardGeocode('pk.t', 'x', 'en', null, fetcher);
    expect(result.ok ? null : result.error).toEqual({ kind: 'http', status: 500 });
  });
});
