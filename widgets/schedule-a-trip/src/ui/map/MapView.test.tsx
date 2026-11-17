import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBo } from '../../test/fake-bo';
import { renderInWidget } from '../../test/render';
import { injectMapboxCss } from './MapboxMap';
import { MapView, type MapViewProps } from './MapView';
import { hasWebGl } from './webgl';

type Handler = (event?: unknown) => void;

// A fake of Mapbox GL JS (happy-dom has no WebGL): it records what the widget asks for.
const fake = vi.hoisted(() => {
  class FakeSource {
    readonly setData = vi.fn();
    readonly getClusterExpansionZoom = vi.fn();
    constructor(readonly spec: Record<string, unknown>) {}
  }
  class FakeMap {
    readonly handlers: { event: string; layer: string | null; handler: Handler }[] = [];
    readonly sources = new Map<string, FakeSource>();
    readonly layers: { id: string }[] = [];
    readonly canvas = { style: { cursor: '' } };
    readonly fitBounds = vi.fn();
    readonly easeTo = vi.fn();
    readonly resize = vi.fn();
    readonly remove = vi.fn();
    readonly queryRenderedFeatures = vi.fn((): unknown[] => []);
    constructor(readonly options: Record<string, unknown>) {
      state.maps.push(this);
    }
    on(event: string, layerOrHandler: string | Handler, handler?: Handler) {
      if (typeof layerOrHandler === 'string') this.handlers.push({ event, layer: layerOrHandler, handler: handler! });
      else this.handlers.push({ event, layer: null, handler: layerOrHandler });
      return this;
    }
    emit(event: string, payload?: unknown, layer: string | null = null) {
      for (const entry of this.handlers) if (entry.event === event && entry.layer === layer) entry.handler(payload);
    }
    addControl() {
      return this;
    }
    addSource(id: string, spec: Record<string, unknown>) {
      this.sources.set(id, new FakeSource(spec));
    }
    addLayer(layer: { id: string }) {
      this.layers.push(layer);
    }
    getSource(id: string) {
      return this.sources.get(id);
    }
    getCanvas() {
      return this.canvas;
    }
  }
  class FakeMarker {
    readonly handlers = new Map<string, Handler>();
    readonly remove = vi.fn();
    position: [number, number] = [0, 0];
    constructor(readonly options: Record<string, unknown>) {
      state.markers.push(this);
    }
    setLngLat(position: [number, number]) {
      this.position = position;
      return this;
    }
    getLngLat() {
      return { lng: this.position[0], lat: this.position[1] };
    }
    addTo() {
      return this;
    }
    on(event: string, handler: Handler) {
      this.handlers.set(event, handler);
      return this;
    }
  }
  class NavigationControl {}
  const state = { maps: [] as FakeMap[], markers: [] as FakeMarker[], FakeMap, FakeMarker, NavigationControl };
  return state;
});

vi.mock('mapbox-gl', () => ({
  default: { Map: fake.FakeMap, Marker: fake.FakeMarker, NavigationControl: fake.NavigationControl },
}));
vi.mock('./webgl', () => ({ hasWebGl: vi.fn(() => true) }));

const center = { latitude: 48.8566, longitude: 2.3522 };
const markers: MapViewProps['markers'] = [
  { id: 'v1', point: { latitude: 48.857, longitude: 2.353 }, tone: 'ok', label: 'AB-123-CD' },
  { id: 'v2', point: { latitude: 48.87, longitude: 2.4 }, tone: 'muted', label: 'EF-456-GH' },
];

let unmount: (() => void) | undefined;
beforeEach(() => {
  fake.maps.length = 0;
  fake.markers.length = 0;
  vi.mocked(hasWebGl).mockReturnValue(true);
});
afterEach(() => {
  unmount?.();
  unmount = undefined;
});

async function render(props: Partial<MapViewProps> = {}) {
  const bo = fakeBo();
  const view = await renderInWidget(
    <MapView token="pk.test" center={center} radiusMeters={500} label="Pickup point" {...props} />,
    bo.api,
  );
  unmount = view.unmount;
  return { ...view, bo };
}

/** Renders the interactive map and fires its `load`. */
async function renderLoaded(props: Partial<MapViewProps> = {}) {
  const view = await render(props);
  await vi.waitFor(() => expect(fake.maps).toHaveLength(1));
  const map = fake.maps[0]!;
  map.emit('load');
  await vi.waitFor(() => expect(map.fitBounds).toHaveBeenCalled());
  return { ...view, map, pin: fake.markers[0]! };
}

describe('MapView', () => {
  it('shows the static drawing with the explanation of the token, without loading Mapbox GL JS, when there is no token', async () => {
    const view = await render({ token: null });
    await vi.waitFor(() =>
      expect(view.container.textContent).toContain(
        'The map needs a valid Mapbox public token restricted to this back office. Set it in Configuration > Widgets.',
      ),
    );
    expect(view.container.querySelector('img')).toBeNull();
    expect(fake.maps).toHaveLength(0);
  });

  it('shows the static image of Mapbox without WebGL, and says why in the logs', async () => {
    vi.mocked(hasWebGl).mockReturnValue(false);
    const view = await render();
    await vi.waitFor(() => expect(view.container.querySelector('img')?.getAttribute('src')).toContain('access_token=pk.test'));
    expect(fake.maps).toHaveLength(0);
    expect(view.bo.api.log.warn).toHaveBeenCalledWith('The interactive map needs WebGL: the static map is shown', undefined);
  });

  it('builds the map with the token of the settings, the pickup point, its radius and the vehicles', async () => {
    const { map, pin } = await renderLoaded({ markers });
    expect(map.options).toMatchObject({
      accessToken: 'pk.test',
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [center.longitude, center.latitude],
      attributionControl: true,
    });
    expect(pin.position).toEqual([center.longitude, center.latitude]);
    expect(map.layers.map((layer) => layer.id)).toEqual([
      'pickup-radius-fill',
      'pickup-radius-line',
      'vehicle-clusters',
      'vehicle-cluster-count',
      'vehicles',
    ]);
    const vehicles = map.sources.get('vehicles')?.spec;
    expect(vehicles).toMatchObject({ cluster: true });
    expect(vehicles?.data).toMatchObject({
      features: [
        { properties: { id: 'v1', inRange: true, highlighted: false }, geometry: { coordinates: [2.353, 48.857] } },
        { properties: { id: 'v2', inRange: false } },
      ],
    });
    const radius = map.sources.get('pickup-radius')?.spec.data as { features: unknown[] };
    expect(radius.features).toHaveLength(1);
    // The view fits the radius and the farthest vehicle.
    const [[west, south], [east, north]] = map.fitBounds.mock.calls[0]?.[0] as number[][] as [[number, number], [number, number]];
    expect(east).toBeGreaterThanOrEqual(2.4);
    expect(north).toBeGreaterThanOrEqual(48.87);
    expect(west).toBeLessThan(center.longitude);
    expect(south).toBeLessThan(center.latitude);
  });

  it('picks the point clicked or where the pin is dropped, but not a click on a vehicle', async () => {
    const onPick = vi.fn();
    const { map, pin } = await renderLoaded({ onPick });
    expect(pin.options.draggable).toBe(true);

    map.emit('click', { point: { x: 1, y: 2 }, lngLat: { lat: 48.9, lng: 2.4 } });
    expect(onPick).toHaveBeenLastCalledWith({ latitude: 48.9, longitude: 2.4 });

    pin.setLngLat([2.5, 48.95]);
    pin.handlers.get('dragend')?.();
    expect(onPick).toHaveBeenLastCalledWith({ latitude: 48.95, longitude: 2.5 });

    map.queryRenderedFeatures.mockReturnValueOnce([{ properties: { id: 'v1' } }]);
    map.emit('click', { point: { x: 1, y: 2 }, lngLat: { lat: 1, lng: 1 } });
    expect(onPick).toHaveBeenCalledTimes(2);
  });

  it('keeps the pin fixed without onPick', async () => {
    const { map, pin } = await renderLoaded();
    expect(pin.options.draggable).toBe(false);
    map.emit('click', { point: { x: 1, y: 2 }, lngLat: { lat: 48.9, lng: 2.4 } });
  });

  it('syncs the hover and the click of a vehicle with the list, and draws the highlighted one', async () => {
    const onMarkerHover = vi.fn();
    const onMarkerClick = vi.fn();
    const { map, rerender } = await renderLoaded({ markers, onMarkerHover, onMarkerClick });

    map.emit('mouseenter', { features: [{ properties: { id: 'v2' } }] }, 'vehicles');
    expect(onMarkerHover).toHaveBeenLastCalledWith('v2');
    expect(map.canvas.style.cursor).toBe('pointer');
    map.emit('mouseleave', {}, 'vehicles');
    expect(onMarkerHover).toHaveBeenLastCalledWith(null);
    map.emit('click', { features: [{ properties: { id: 'v1' } }] }, 'vehicles');
    expect(onMarkerClick).toHaveBeenCalledWith('v1');

    const fits = map.fitBounds.mock.calls.length;
    rerender(
      <MapView
        token="pk.test"
        center={center}
        radiusMeters={500}
        label="Pickup point"
        markers={markers?.map((marker) => ({ ...marker, highlighted: marker.id === 'v2' }))}
        onMarkerHover={onMarkerHover}
      />,
    );
    const source = map.sources.get('vehicles');
    await vi.waitFor(() =>
      expect(source?.setData).toHaveBeenLastCalledWith(
        expect.objectContaining({
          features: expect.arrayContaining([expect.objectContaining({ properties: expect.objectContaining({ id: 'v2', highlighted: true }) })]),
        }),
      ),
    );
    // A new highlight does not move the view.
    expect(map.fitBounds).toHaveBeenCalledTimes(fits);
  });

  it('zooms into a cluster clicked', async () => {
    const { map } = await renderLoaded({ markers });
    const source = map.sources.get('vehicles')!;
    source.getClusterExpansionZoom.mockImplementation((_id: number, callback: (error: null, zoom: number) => void) =>
      callback(null, 15),
    );
    map.emit(
      'click',
      { features: [{ properties: { cluster_id: 3 }, geometry: { type: 'Point', coordinates: [2.35, 48.85] } }] },
      'vehicle-clusters',
    );
    expect(map.easeTo).toHaveBeenCalledWith({ center: [2.35, 48.85], zoom: 15 });
  });

  it.each([401, 403])('explains the token when Mapbox answers %i, and logs it', async (status) => {
    const { map, container, bo } = await renderLoaded();

    map.emit('error', { error: Object.assign(new Error('Unauthorized'), { status }) });

    await vi.waitFor(() =>
      expect(container.textContent).toContain('The map needs a valid Mapbox public token restricted to this back office.'),
    );
    expect(container.querySelector('img')).toBeNull();
    expect(map.remove).toHaveBeenCalled();
    expect(bo.api.log.error).toHaveBeenCalledWith('Mapbox refused the token of the settings', { status });
  });

  it('falls back to the static image when the style cannot be loaded', async () => {
    const view = await render();
    await vi.waitFor(() => expect(fake.maps).toHaveLength(1));

    fake.maps[0]!.emit('error', { error: new Error('Failed to fetch') });

    await vi.waitFor(() => expect(view.container.querySelector('img')).not.toBeNull());
    expect(view.bo.api.log.error).toHaveBeenCalledWith(
      'The interactive map could not be loaded: the static map is shown',
      { message: 'Failed to fetch' },
    );
  });

  it('keeps the map after a tile failed once it showed, and logs it once', async () => {
    const { map, container, bo } = await renderLoaded();
    map.emit('error', { error: Object.assign(new Error('Not found'), { status: 404 }) });
    map.emit('error', { error: Object.assign(new Error('Not found'), { status: 404 }) });
    expect(bo.api.log.warn).toHaveBeenCalledTimes(1);
    expect(bo.api.log.warn).toHaveBeenCalledWith('The map could not load a resource', { status: 404, message: 'Not found' });
    expect(container.querySelector('[data-mapbox-map]')).not.toBeNull();
    expect(map.remove).not.toHaveBeenCalled();
  });

  it('removes the map on unmount', async () => {
    const { map, pin } = await renderLoaded();
    unmount?.();
    unmount = undefined;
    expect(map.remove).toHaveBeenCalledTimes(1);
    expect(pin.remove).toHaveBeenCalledTimes(1);
  });
});

describe('injectMapboxCss', () => {
  it('adds the style once to the shadow root, never to the head of the document', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const first = document.createElement('div');
    const second = document.createElement('div');
    shadow.append(first, second);

    injectMapboxCss(first);
    injectMapboxCss(second);

    expect(shadow.querySelectorAll('style[data-mapbox-gl-css]')).toHaveLength(1);
    expect(document.head.querySelector('style[data-mapbox-gl-css]')).toBeNull();
    host.remove();
  });
});
