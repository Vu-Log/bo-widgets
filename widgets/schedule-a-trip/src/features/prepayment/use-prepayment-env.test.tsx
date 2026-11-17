import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyText } from '../../test/dom';
import { VALID_SETTINGS } from '../../test/fake-bo';
import { renderWithBilling } from '../../test/prepayment-fixtures';
import { usePrepaymentEnv } from './use-prepayment-env';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

function Probe() {
  const env = usePrepaymentEnv();
  return <span>{[env.fleetId, env.currency, env.deps ? 'deps' : 'no-deps', env.blocker?.key ?? 'ready', env.formatAmount(12.5)].join('|')}</span>;
}

describe('usePrepaymentEnv', () => {
  it('gives the dependencies, the currency of the settings and no blocker', async () => {
    const rendered = await renderWithBilling(<Probe />);
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(bodyText()).toBe('FLEET-1|EUR|deps|ready|€12.50'));
  });

  it('falls back on the currency of the fleet, or a plain number', async () => {
    const rendered = await renderWithBilling(<Probe />, {
      bo: {
        getSettings: async () => ({ ...VALID_SETTINGS }),
        getContext: async () => ({ fleetId: 'FLEET-1', locale: 'en_GB', basename: '/', currency: 'USD' }),
      },
    });
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(bodyText()).toBe('FLEET-1|USD|deps|ready|US$12.50'));
  });

  it('blocks without an operator id, or when the settings cannot be read', async () => {
    const rendered = await renderWithBilling(<Probe />, {
      bo: { getCurrentUser: async () => ({ id: null, fullName: 'Jane Doe', roles: [] }), getSettings: async () => ({ ...VALID_SETTINGS }) },
    });
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(bodyText()).toBe('FLEET-1||no-deps|prepayment.blocked.noUser|12.5'));
  });

  it('says the settings are unavailable when the back office refuses them', async () => {
    const rendered = await renderWithBilling(<Probe />, {
      bo: { getSettings: async () => Promise.reject(Object.assign(new Error('no'), { code: 'forbidden', status: 403 })) },
    });
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(bodyText()).toContain('settings.unavailable'));
  });
});
