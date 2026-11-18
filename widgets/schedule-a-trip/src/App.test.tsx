import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageStatusBanner } from './App';
import { LANGUAGE_LOADERS, languageStatus, resetLanguagesForTests } from './i18n';
import { button, click } from './test/dom';
import { fakeBo } from './test/fake-bo';
import { renderInWidget } from './test/render';

let unmount: (() => void) | undefined;
beforeEach(() => resetLanguagesForTests());
afterEach(() => {
  unmount?.();
  unmount = undefined;
  vi.restoreAllMocks();
});

const hungarian = () =>
  fakeBo({ getContext: async () => ({ fleetId: 'FLEET-1', locale: 'hu_HU', basename: '/' }) });

describe('LanguageStatusBanner', () => {
  it('shows nothing while the language loads and once it is loaded', async () => {
    const bo = hungarian();
    const view = await renderInWidget(<LanguageStatusBanner />, bo.api);
    unmount = view.unmount;
    expect(languageStatus('hu')).not.toBe('loaded');
    expect(view.container.textContent).toBe('');
    await vi.waitFor(() => expect(languageStatus('hu')).toBe('loaded'));
    expect(view.container.textContent).toBe('');
    expect(bo.api.log.error).not.toHaveBeenCalled();
  });

  it('says the widget stays in English when the texts cannot be loaded, logs it, and retries', async () => {
    const offline = new TypeError('Failed to fetch dynamically imported module');
    vi.spyOn(LANGUAGE_LOADERS, 'hu').mockRejectedValueOnce(offline);
    const bo = hungarian();
    const view = await renderInWidget(<LanguageStatusBanner />, bo.api);
    unmount = view.unmount;

    await vi.waitFor(() =>
      expect(view.container.textContent).toContain(
        'The texts in your language could not be loaded: the widget is shown in English.',
      ),
    );
    expect(bo.api.log.error).toHaveBeenCalledWith('The texts of the language could not be loaded', {
      language: 'hu',
      name: 'TypeError',
      message: 'Failed to fetch dynamically imported module',
    });

    click('Retry');

    await vi.waitFor(() => expect(view.container.textContent).toBe(''));
    expect(button('Retry')).toBeUndefined();
    expect(LANGUAGE_LOADERS.hu).toHaveBeenCalledTimes(2);
  });
});
