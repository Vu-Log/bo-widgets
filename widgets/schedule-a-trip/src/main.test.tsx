import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Widget from './main';
import { loadLanguage } from './i18n';
import { fakeBo, jsonResponse, VALID_SETTINGS } from './test/fake-bo';
import { installFakeIntersectionObserver } from './test/intersection-observer';

customElements.define('test-widget', Widget);

const mount = (api: object): HTMLElement => {
  const element = Object.assign(document.createElement('test-widget'), { vulogBo: api });
  document.body.append(element);
  return element;
};

const text = (element: HTMLElement): string => element.shadowRoot?.textContent ?? '';
const tabs = (element: HTMLElement) => [
  ...(element.shadowRoot?.querySelectorAll('[role="tab"]') ?? []),
];
/** The label of a tab, without its count. */
const label = (tab: Element | undefined | null) => tab?.textContent?.replace(/\d+$/, '');
const panelText = (element: HTMLElement) =>
  element.shadowRoot?.querySelector('[role="tabpanel"]')?.textContent ?? '';

/** The Vulog API of a fleet without any booking. */
const stubEmptyApi = () =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () =>
      jsonResponse([], { headers: { totalelements: '0', totalpages: '0' } }),
    );

describe('Widget', () => {
  beforeEach(() => {
    localStorage.clear();
    installFakeIntersectionObserver();
    stubEmptyApi();
  });
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('shows its title and the five tabs, Upcoming first selected', async () => {
    const element = mount(fakeBo().api);

    await vi.waitFor(() => expect(text(element)).toContain('Schedule a trip'));
    expect(tabs(element).map(label)).toEqual([
      'Alert',
      'Upcoming',
      'Ongoing',
      'Completed',
      'Cancelled',
    ]);
    expect(label(element.shadowRoot?.querySelector('[role="tab"][aria-selected="true"]'))).toBe(
      'Upcoming',
    );
    await vi.waitFor(() => expect(panelText(element)).toContain('No upcoming booking.'));
    // The counts come from the totals of the API.
    await vi.waitFor(() => expect(tabs(element)[0]?.textContent).toBe('Alert0'));
  });

  it('shows the panel of the tab chosen', async () => {
    const element = mount(fakeBo().api);
    await vi.waitFor(() => expect(tabs(element)).toHaveLength(5));

    (tabs(element).find((tab) => label(tab) === 'Cancelled') as HTMLElement).click();

    await vi.waitFor(() => expect(panelText(element)).toContain('No cancelled booking.'));
    const panel = element.shadowRoot?.querySelector('[role="tabpanel"]');
    const selected = element.shadowRoot?.querySelector('[role="tab"][aria-selected="true"]');
    expect(panel?.getAttribute('aria-labelledby')).toBe(selected?.id);
  });

  it('shows no banner when the settings are valid', async () => {
    const { api } = fakeBo();
    const element = mount(api);
    await vi.waitFor(() => expect(api.getSettings).toHaveBeenCalled());
    await vi.waitFor(() => expect(text(element)).toContain('Schedule a trip'));
    expect(text(element)).not.toContain('Configuration incomplete');
  });

  it('shows the configuration incomplete banner when the settings are invalid', async () => {
    const element = mount(
      fakeBo({
        getSettings: async () => ({ ...VALID_SETTINGS, ratio: 0, prepaymentProductId: '' }),
      }).api,
    );

    await vi.waitFor(() => expect(text(element)).toContain('Configuration incomplete'));
    expect(
      [...(element.shadowRoot?.querySelectorAll('li') ?? [])].map(
        (item) => item.querySelector('code')?.textContent,
      ),
    ).toEqual(['prepaymentProductId', 'ratio']);
  });

  it('says when the settings cannot be read', async () => {
    const element = mount(
      fakeBo({ getSettings: () => Promise.reject(new Error('not installed')) }).api,
    );

    await vi.waitFor(() =>
      expect(text(element)).toContain('The settings of the widget could not be loaded.'),
    );
    expect(text(element)).not.toContain('not installed');
    expect(element.shadowRoot?.querySelector('[role="alert"]')?.getAttribute('title')).toBe(
      'not installed',
    );
  });

  it('follows the locale of the back office', async () => {
    const { api, emit } = fakeBo();
    const element = mount(api);
    await vi.waitFor(() => expect(tabs(element)).toHaveLength(5));

    emit('localeChanged', { locale: 'fr_FR' });

    await vi.waitFor(() => expect(label(tabs(element)[1])).toBe('À venir'));
  });

  it.each([
    ['de_DE', 'de'],
    ['it_IT', 'it'],
    ['nl_NL', 'nl'],
    ['es_ES', 'es'],
    ['pt_BR', 'pt'],
    ['hu_HU', 'hu'],
  ] as const)('speaks the language of the BO locale %s', async (locale, language) => {
    const { messages } = await loadLanguage(language);
    const element = mount(
      fakeBo({
        getContext: async () => ({ fleetId: 'FLEET-1', locale, basename: '/' }),
        getSettings: async () => ({ ...VALID_SETTINGS, ratio: 0 }),
      }).api,
    );

    await vi.waitFor(() => expect(text(element)).toContain(messages['settings.incomplete.title']));
    expect(tabs(element).map(label)).toEqual([
      messages['tabs.alert'],
      messages['tabs.upcoming'],
      messages['tabs.ongoing'],
      messages['tabs.completed'],
      messages['tabs.cancelled'],
    ]);
    await vi.waitFor(() => expect(panelText(element)).toContain(messages['tabs.empty.upcoming']));
    expect(text(element)).toContain(messages['settings.issue.invalid']);
  });

  it('shows an error when the back office state cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const element = mount(fakeBo({ getContext: () => Promise.reject(new Error('boom')) }).api);

    await vi.waitFor(() =>
      expect(element.shadowRoot?.querySelector('[role="alert"]')?.textContent).toContain('boom'),
    );
  });

  it('keeps its styles in the shadow root', async () => {
    const element = mount(fakeBo().api);
    await vi.waitFor(() => expect(tabs(element)).toHaveLength(5));
    expect(element.shadowRoot?.querySelector('style')).not.toBeNull();
    expect(document.head.querySelector('style[data-emotion]')).toBeNull();
  });

  it('closes the connection once removed', async () => {
    const { api } = fakeBo();
    const element = mount(api);
    await vi.waitFor(() => expect(text(element)).toContain('Schedule a trip'));

    element.remove();

    await vi.waitFor(() => expect(api.off).toHaveBeenCalled());
  });
});
