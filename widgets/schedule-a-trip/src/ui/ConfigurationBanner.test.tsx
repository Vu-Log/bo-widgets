import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBo } from '../test/fake-bo';
import { renderInWidget } from '../test/render';
import { ConfigurationBanner } from './ConfigurationBanner';

let unmount: (() => void) | undefined;
afterEach(() => unmount?.());

const issues = [
  { key: 'ratio', message: 'Too small' },
  { key: 'mapboxToken', message: 'Required' },
];

describe('ConfigurationBanner', () => {
  it('lists the settings to fix', async () => {
    const view = await renderInWidget(<ConfigurationBanner issues={issues} />);
    unmount = view.unmount;
    await vi.waitFor(() =>
      expect(view.container.textContent).toContain('Configuration incomplete'),
    );
    expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
    expect([...view.container.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'ratio: Too small',
      'mapboxToken: Required',
    ]);
  });

  it('speaks the language of the back office', async () => {
    const { api } = fakeBo({
      getContext: async () => ({ fleetId: 'FLEET-1', locale: 'fr_FR', basename: '/' }),
    });
    const view = await renderInWidget(<ConfigurationBanner issues={issues} />, api);
    unmount = view.unmount;
    await vi.waitFor(() =>
      expect(view.container.textContent).toContain('Configuration incomplète'),
    );
  });
});
