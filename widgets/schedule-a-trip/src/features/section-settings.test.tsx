import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBo, VALID_SETTINGS } from '../test/fake-bo';
import { renderInWidget } from '../test/render';
import {
  fleetTimeZone,
  parseSectionSettings,
  useFleetTimeZone,
  useSectionSettings,
} from './section-settings';

describe('parseSectionSettings', () => {
  it('reads the token, the radius and the time zone', () => {
    expect(parseSectionSettings({ ...VALID_SETTINGS, vehicleSearchRadius: 800, timezone: 'Europe/Paris' })).toEqual({
      mapboxToken: 'pk.placeholder',
      vehicleSearchRadius: 800,
      timezone: 'Europe/Paris',
    });
  });

  it('keeps the map when the prepayment settings are invalid', () => {
    expect(parseSectionSettings({ mapboxToken: ' pk.abc ', dayRate: -1 }).mapboxToken).toBe('pk.abc');
  });

  it('gives the defaults for missing or invalid values', () => {
    expect(
      parseSectionSettings({ mapboxToken: 'sk.secret', vehicleSearchRadius: -3, timezone: 'Not/AZone' }),
    ).toEqual({ mapboxToken: null, vehicleSearchRadius: 500, timezone: null });
    expect(parseSectionSettings(null)).toEqual({ mapboxToken: null, vehicleSearchRadius: 500, timezone: null });
  });
});

describe('fleetTimeZone', () => {
  it('prefers the zone of the fleet, then the settings', () => {
    expect(fleetTimeZone('Asia/Tokyo', 'Europe/Paris')).toBe('Asia/Tokyo');
    expect(fleetTimeZone(null, 'Europe/Paris')).toBe('Europe/Paris');
  });

  it('skips a zone the browser does not know, then gives null', () => {
    expect(fleetTimeZone('Not/AZone', 'Europe/Paris')).toBe('Europe/Paris');
    expect(fleetTimeZone('Not/AZone', null)).toBeNull();
  });
});

describe('useSectionSettings and useFleetTimeZone', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => {
    unmount?.();
    unmount = undefined;
  });

  function Probe() {
    const settings = useSectionSettings();
    const zone = useFleetTimeZone();
    if (settings.isError) return <p>error</p>;
    return <p>{settings.data ? `${settings.data.mapboxToken} ${zone}` : 'loading'}</p>;
  }

  it('reads the settings and the zone of the fleet', async () => {
    const bo = fakeBo({
      getContext: async () => ({ fleetId: 'FLEET-1', locale: 'en_GB', basename: '/', timezone: 'Asia/Tokyo' }),
    });
    const view = await renderInWidget(<Probe />, bo.api);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toBe('pk.placeholder Asia/Tokyo'));
  });

  it('fails when the back office cannot give the settings', async () => {
    const bo = fakeBo();
    bo.api.getSettings.mockRejectedValue(Object.assign(new Error('boom'), { code: 'internal' }));
    const view = await renderInWidget(<Probe />, bo.api);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toBe('error'));
  });
});
