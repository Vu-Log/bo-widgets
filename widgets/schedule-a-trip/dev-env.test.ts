import { describe, expect, it } from 'vitest';
import { devOverrides } from './dev-env';

describe('devOverrides', () => {
  it('gives nothing without variables', () => {
    expect(devOverrides({})).toEqual({});
  });

  it('reads the fleet and the settings', () => {
    expect(
      devOverrides({ BO_WIDGET_FLEET_ID: ' FLEET-9 ', BO_WIDGET_SETTINGS: '{"dayRate":120,"currency":"EUR"}' }),
    ).toEqual({ fleetId: 'FLEET-9', settings: { dayRate: 120, currency: 'EUR' } });
  });

  it('ignores empty variables', () => {
    expect(devOverrides({ BO_WIDGET_FLEET_ID: '  ', BO_WIDGET_SETTINGS: '' })).toEqual({});
  });

  it('fails on settings that are not JSON', () => {
    expect(() => devOverrides({ BO_WIDGET_SETTINGS: '{dayRate:120}' })).toThrow(/must be a JSON object/);
  });

  it('fails on settings that are not an object', () => {
    expect(() => devOverrides({ BO_WIDGET_SETTINGS: '[1,2]' })).toThrow(/must be a JSON object/);
    expect(() => devOverrides({ BO_WIDGET_SETTINGS: 'null' })).toThrow(/must be a JSON object/);
  });
});
