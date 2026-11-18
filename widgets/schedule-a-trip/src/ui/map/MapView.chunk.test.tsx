import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBo } from '../../test/fake-bo';
import { renderInWidget } from '../../test/render';
import { MapView } from './MapView';

// The chunk of the interactive map cannot be loaded (CDN, network).
vi.mock('./MapboxMap', () => {
  throw new TypeError('Failed to fetch dynamically imported module');
});
vi.mock('./webgl', () => ({ hasWebGl: () => true }));

let unmount: (() => void) | undefined;
afterEach(() => unmount?.());

describe('MapView, when the chunk of the map cannot be loaded', () => {
  it('shows the static image of Mapbox, and logs the failure', async () => {
    const bo = fakeBo();
    const view = await renderInWidget(
      <MapView token="pk.test" center={{ latitude: 48.85, longitude: 2.35 }} radiusMeters={500} label="Pickup point" />,
      bo.api,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.querySelector('img')?.getAttribute('src')).toContain('access_token=pk.test'));
    expect(bo.api.log.error).toHaveBeenCalledWith(
      'A part of the widget could not be loaded',
      expect.objectContaining({ chunk: 'map' }),
    );
  });
});
