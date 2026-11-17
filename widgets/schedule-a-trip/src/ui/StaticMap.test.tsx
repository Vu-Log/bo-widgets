import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInWidget } from '../test/render';
import { StaticMap } from './StaticMap';

const center = { latitude: 48.8566, longitude: 2.3522 };
let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  unmount = undefined;
});

const render = async (ui: Parameters<typeof renderInWidget>[0]) => {
  const view = await renderInWidget(ui);
  unmount = view.unmount;
  await vi.waitFor(() => expect(view.container.querySelector('svg[role="img"]')).not.toBeNull());
  return view;
};

describe('StaticMap', () => {
  it('draws the static image of Mapbox with the radius and the markers over it', async () => {
    const view = await render(
      <StaticMap
        token="pk.test"
        center={center}
        radiusMeters={500}
        markers={[
          { id: 'v1', point: { latitude: 48.857, longitude: 2.353 }, tone: 'ok', label: 'AB-123-CD' },
          { id: 'v2', point: { latitude: 48.86, longitude: 2.36 }, tone: 'muted', highlighted: true, label: 'Far' },
        ]}
        label="Pickup point"
      />,
    );
    const image = view.container.querySelector('img');
    expect(image?.getAttribute('src')).toMatch(/^https:\/\/api\.mapbox\.com\/styles\/v1\/mapbox\/streets-v12\/static\//);
    expect(image?.getAttribute('src')).toContain('access_token=pk.test');
    // The image keeps the Mapbox logo and the attribution that the Static Images API draws.
    expect(image?.getAttribute('src')).not.toMatch(/(attribution|logo)=false/);
    expect(view.container.querySelector('svg')?.getAttribute('aria-label')).toBe('Pickup point');
    expect(Number(view.container.querySelector('[data-radius]')?.getAttribute('r'))).toBeGreaterThan(0);
    expect(view.container.querySelector('[data-marker="v2"]')?.getAttribute('r')).toBe('8');
    expect(view.container.querySelector('[data-marker="v1"] title')?.textContent).toBe('AB-123-CD');
  });

  it('keeps the drawing and says so without a token', async () => {
    const view = await render(<StaticMap token={null} center={center} radiusMeters={null} label="Map" />);
    expect(view.container.querySelector('img')).toBeNull();
    expect(view.container.querySelector('[data-radius]')).toBeNull();
    expect(view.container.textContent).toContain('The map needs a valid Mapbox public token restricted to this back office.');
  });

  it('says when the image cannot load', async () => {
    const view = await render(<StaticMap token="pk.test" center={center} radiusMeters={300} label="Map" />);
    view.container.querySelector('img')?.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(view.container.querySelector('img')).toBeNull());
    expect(view.container.textContent).toContain('could not be loaded');
  });

  it('zooms in and out with its buttons', async () => {
    const view = await render(<StaticMap token="pk.test" center={center} radiusMeters={300} label="Map" />);
    const zoomOf = () => /static\/[^/]+,[^/]+,(\d+)\//.exec(view.container.querySelector('img')?.getAttribute('src') ?? '')?.[1];
    const before = Number(zoomOf());
    view.container.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')?.click();
    await vi.waitFor(() => expect(Number(zoomOf())).toBe(before + 1));
    view.container.querySelector<HTMLButtonElement>('button[aria-label="Zoom out"]')?.click();
    view.container.querySelector<HTMLButtonElement>('button[aria-label="Zoom out"]')?.click();
    await vi.waitFor(() => expect(Number(zoomOf())).toBe(before - 1));
  });

  it('gives the point clicked, and the marker clicked', async () => {
    const onPick = vi.fn();
    const onMarkerClick = vi.fn();
    const view = await render(
      <StaticMap
        token="pk.test"
        center={center}
        radiusMeters={300}
        label="Map"
        onPick={onPick}
        onMarkerClick={onMarkerClick}
        markers={[{ id: 'v1', point: center, tone: 'ok', label: 'v1' }]}
      />,
    );
    const svg = view.container.querySelector('svg')!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    svg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 200, clientY: 110 }));
    expect(onPick).toHaveBeenCalledTimes(1);
    const [point] = onPick.mock.calls[0] as [{ latitude: number; longitude: number }];
    expect(point.latitude).toBeCloseTo(center.latitude, 3);
    expect(point.longitude).toBeCloseTo(center.longitude, 3);

    view.container.querySelector('[data-marker="v1"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onMarkerClick).toHaveBeenCalledWith('v1');
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});
