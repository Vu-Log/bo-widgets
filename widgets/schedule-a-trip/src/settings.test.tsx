import { afterEach, describe, expect, it, vi } from 'vitest';
import widget from '../widget.config';
import { parseSettings, settingsSchema, useWidgetSettings, type SettingsResult } from './settings';
import { fakeBo, VALID_SETTINGS } from './test/fake-bo';
import { renderInWidget } from './test/render';

// The settings without a default.
const {
  refundFullHours: _full,
  creditsRevokeHours: _revoke,
  vehicleSearchRadius: _radius,
  ...required
} = VALID_SETTINGS;

const issueKeys = (result: SettingsResult) =>
  result.ok ? [] : result.issues.map((issue) => issue.key);

describe('parseSettings', () => {
  it('accepts complete settings', () => {
    expect(parseSettings({ ...VALID_SETTINGS, currency: 'EUR', timezone: 'Europe/Paris' })).toEqual(
      {
        ok: true,
        settings: { ...VALID_SETTINGS, currency: 'EUR', timezone: 'Europe/Paris' },
      },
    );
  });

  it('applies the defaults of the optional numbers', () => {
    const result = parseSettings(required);
    expect(result.ok && result.settings).toMatchObject({
      refundFullHours: 24,
      creditsRevokeHours: 1,
      vehicleSearchRadius: 500,
    });
  });

  it('treats a blank currency or time zone as not set', () => {
    const result = parseSettings({
      ...VALID_SETTINGS,
      currency: '  ',
      timezone: '',
      mapboxToken: ' pk.token ',
    });
    expect(result.ok && result.settings).toMatchObject({
      currency: undefined,
      timezone: undefined,
      mapboxToken: 'pk.token',
    });
    expect(parseSettings({ ...VALID_SETTINGS, currency: null }).ok).toBe(true);
  });

  it('lists every missing required setting', () => {
    expect(issueKeys(parseSettings({}))).toEqual([
      'prepaymentProductId',
      'cancellationFeesProductId',
      'dayRate',
      'ratio',
      'minimumAmount',
      'mapboxToken',
    ]);
  });

  it('refuses product ids that are not uuids', () => {
    expect(
      issueKeys(parseSettings({ ...VALID_SETTINGS, prepaymentProductId: 'product-1' })),
    ).toEqual(['prepaymentProductId']);
  });

  it.each([
    ['dayRate', 0],
    ['dayRate', -1],
    ['ratio', 0],
    ['ratio', -0.5],
    ['minimumAmount', 0],
    ['vehicleSearchRadius', 0],
    ['refundFullHours', -1],
    ['creditsRevokeHours', -1],
    ['dayRate', '100'],
    ['ratio', Number.NaN],
  ])('refuses %s = %s', (key, value) => {
    expect(issueKeys(parseSettings({ ...VALID_SETTINGS, [key]: value }))).toContain(key);
  });

  it('accepts 0 hours for both refund thresholds', () => {
    expect(parseSettings({ ...VALID_SETTINGS, refundFullHours: 0, creditsRevokeHours: 0 }).ok).toBe(
      true,
    );
  });

  it('refuses a credits threshold greater than the full refund threshold', () => {
    expect(
      issueKeys(parseSettings({ ...VALID_SETTINGS, refundFullHours: 1, creditsRevokeHours: 2 })),
    ).toEqual(['creditsRevokeHours']);
  });

  it('refuses a blank Mapbox token, a bad currency and an unknown time zone', () => {
    expect(
      issueKeys(
        parseSettings({
          ...VALID_SETTINGS,
          mapboxToken: ' ',
          currency: 'euro',
          timezone: 'Mars/Base',
        }),
      ),
    ).toEqual(['mapboxToken', 'currency', 'timezone']);
  });

  it('refuses a secret Mapbox token', () => {
    expect(issueKeys(parseSettings({ ...VALID_SETTINGS, mapboxToken: 'sk.secret' }))).toEqual([
      'mapboxToken',
    ]);
  });

  it('refuses what is not an object', () => {
    expect(issueKeys(parseSettings(null))).toEqual(['(settings)']);
    expect(issueKeys(parseSettings('settings'))).toEqual(['(settings)']);
  });
});

describe('the manifest settings', () => {
  it('declare the keys of the schema, with the same defaults', () => {
    const declared = widget.settings ?? [];
    expect(declared.map((setting) => setting.key).sort()).toEqual(
      Object.keys(settingsSchema.shape).sort(),
    );
    const defaults = parseSettings(required);
    for (const setting of declared) {
      if (setting.default !== undefined) {
        expect(
          defaults.ok && defaults.settings[setting.key as keyof typeof defaults.settings],
        ).toBe(setting.default);
      }
    }
  });

  it('give valid dev settings to the fake back office', () => {
    expect(parseSettings(widget.dev?.settings).ok).toBe(true);
  });

  it('require the settings the schema requires without a default', () => {
    const requiredKeys = (widget.settings ?? [])
      .filter((setting) => setting.required)
      .map((setting) => setting.key);
    expect(requiredKeys.sort()).toEqual(Object.keys(required).sort());
  });
});

function SettingsProbe() {
  const settings = useWidgetSettings();
  if (settings.isError) return <p>error: {settings.error.message}</p>;
  if (!settings.data) return <p>loading</p>;
  return (
    <p>
      {settings.data.ok
        ? `ok ${settings.data.settings.dayRate}`
        : `invalid ${issueKeys(settings.data).join(',')}`}
    </p>
  );
}

describe('useWidgetSettings', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => {
    unmount?.();
    vi.restoreAllMocks();
  });

  it('gives the checked settings of the back office', async () => {
    const view = await renderInWidget(<SettingsProbe />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toBe('ok 100'));
  });

  it('gives the issues of invalid settings', async () => {
    const { api } = fakeBo({ getSettings: async () => ({ ...VALID_SETTINGS, ratio: -1 }) });
    const view = await renderInWidget(<SettingsProbe />, api);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toBe('invalid ratio'));
  });

  it('fails when the back office cannot give the settings', async () => {
    const { api } = fakeBo({ getSettings: () => Promise.reject(new Error('not installed')) });
    const view = await renderInWidget(<SettingsProbe />, api);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toBe('error: not installed'));
  });
});
