import { afterEach, describe, expect, it, vi } from 'vitest';
import widget from '../widget.config';
import { LIST_TABS } from './domain/statuses';
import {
  CATALOGUES,
  createI18n,
  LANGUAGES,
  placeholdersOf,
  resolveLanguage,
  translate,
  useI18n,
} from './i18n';
import { fakeBo } from './test/fake-bo';
import { renderInWidget } from './test/render';

const englishKeys = Object.keys(CATALOGUES.en).sort();

describe('the catalogues', () => {
  it.each(LANGUAGES)('%s has exactly the keys of English', (language) => {
    expect(Object.keys(CATALOGUES[language]).sort()).toEqual(englishKeys);
  });

  it.each(LANGUAGES)('%s has the placeholders of English in every message', (language) => {
    for (const key of englishKeys as (keyof typeof CATALOGUES.en)[]) {
      expect({ key, placeholders: placeholdersOf(CATALOGUES[language][key]) }).toEqual({
        key,
        placeholders: placeholdersOf(CATALOGUES.en[key]),
      });
    }
  });

  it.each(LANGUAGES)('%s has no blank message', (language) => {
    for (const message of Object.values(CATALOGUES[language])) expect(message.trim()).not.toBe('');
  });

  it('keeps the product name untranslated', () => {
    for (const language of LANGUAGES)
      expect(CATALOGUES[language]['app.title']).toBe('Schedule a trip');
  });

  it('names every tab', () => {
    for (const tab of LIST_TABS) expect(CATALOGUES.en[`tabs.${tab}`]).toBeTruthy();
  });
});

describe('the manifest', () => {
  it('labels the menu and every setting in the 8 languages', () => {
    const labels = [widget.menu?.label, ...(widget.settings ?? []).map((setting) => setting.label)];
    for (const label of labels) {
      expect(Object.keys(label ?? {}).sort()).toEqual([...LANGUAGES].sort());
      for (const text of Object.values(label ?? {})) expect(text.trim()).not.toBe('');
    }
  });
});

describe('resolveLanguage', () => {
  it.each([
    ['en_GB', 'en'],
    ['de_DE', 'de'],
    ['de_AT', 'de'],
    ['fr_FR', 'fr'],
    ['fr_CA', 'fr'],
    ['it_IT', 'it'],
    ['nl_BE', 'nl'],
    ['es_ES', 'es'],
    ['pt_BR', 'pt'],
    ['pt-PT', 'pt'],
    ['hu_HU', 'hu'],
    ['HU', 'hu'],
  ])('maps %s to %s', (locale, language) => {
    expect(resolveLanguage(locale)).toBe(language);
  });

  it('falls back to English for an unknown, blank or missing locale', () => {
    expect(resolveLanguage('ja_JP')).toBe('en');
    expect(resolveLanguage('')).toBe('en');
    expect(resolveLanguage(null)).toBe('en');
  });
});

describe('placeholdersOf', () => {
  it('lists the placeholders once, sorted', () => {
    expect(placeholdersOf('{b} and {a}, {b}')).toEqual(['a', 'b']);
    expect(placeholdersOf('none')).toEqual([]);
  });
});

describe('translate', () => {
  it('gives the message of the language', () => {
    expect(translate('de', 'tabs.upcoming')).toBe('Anstehend');
    expect(translate('hu', 'grid.retry')).toBe('Újra');
  });

  it('replaces the placeholders', () => {
    expect(translate('fr', 'api.error.http', { status: 502 })).toBe(
      'L’API Vulog a échoué (HTTP 502).',
    );
  });

  it('leaves a placeholder without a value visible', () => {
    expect(translate('en', 'api.error.http', {})).toBe('The Vulog API failed (HTTP {status}).');
    expect(translate('en', 'api.error.http')).toBe('The Vulog API failed (HTTP {status}).');
  });
});

describe('createI18n', () => {
  it('formats numbers, amounts and dates in the locale of the back office', () => {
    const date = new Date(2026, 2, 10, 14, 30);
    const german = createI18n('de_DE');
    expect(german.locale).toBe('de-DE');
    expect(german.formatNumber(1234.5)).toBe('1.234,5');
    expect(german.formatCurrency(20.83, 'EUR').replace(/\s/g, ' ')).toBe('20,83 €');
    expect(german.formatDate(date, 'PPP')).toBe('10. März 2026');
    expect(createI18n('hu_HU').formatDate(date, 'LLLL')).toBe('március');
    expect(createI18n('en_GB').formatDate(date, 'P')).toBe('10/03/2026');
  });

  it('formats a date in a time zone, or in the zone of the browser without one', () => {
    const date = new Date('2026-03-10T12:00:00Z');
    const french = createI18n('fr_FR');
    expect(french.formatDateInZone(date, 'HH:mm', 'Asia/Tokyo')).toBe('21:00');
    expect(french.formatDateInZone(date, 'PPP', 'America/Los_Angeles')).toBe('10 mars 2026');
    expect(french.formatDateInZone(date, 'HH:mm', null)).toBe(french.formatDate(date, 'HH:mm'));
  });

  it('throws on an unknown time zone', () => {
    expect(() => createI18n('en_GB').formatDateInZone(new Date(), 'p', 'Not/AZone')).toThrow(
      RangeError,
    );
  });

  it('says how far a date is from now', () => {
    const now = new Date('2026-03-10T12:00:00Z');
    expect(createI18n('en_GB').formatRelative(new Date('2026-03-10T14:00:00Z'), now)).toBe(
      'in about 2 hours',
    );
    expect(createI18n('de_DE').formatRelative(new Date('2026-03-07T12:00:00Z'), now)).toBe(
      'vor 3 Tagen',
    );
  });

  it('uses the Brazilian date locale for pt_BR', () => {
    const date = new Date(2026, 2, 10);
    expect(createI18n('pt_BR').formatDate(date, 'P')).toBe('10/03/2026');
    expect(createI18n('pt_BR').t('tabs.cancelled')).toBe('Canceladas');
  });

  it('falls back to the language for a locale Intl refuses', () => {
    const i18n = createI18n('es_not a locale');
    expect(i18n.language).toBe('es');
    expect(i18n.locale).toBe('es');
    expect(i18n.formatNumber(1.5)).toBe('1,5');
  });

  it('speaks English without a locale', () => {
    const i18n = createI18n(null);
    expect(i18n.locale).toBe('en');
    expect(i18n.t('tabs.alert')).toBe('Alert');
  });
});

function Probe() {
  const { t, language } = useI18n();
  return (
    <p>
      {language}: {t('tabs.upcoming')}
    </p>
  );
}

describe('useI18n', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => unmount?.());

  it('follows the locale of the back office', async () => {
    const { api, emit } = fakeBo({
      getContext: async () => ({ fleetId: 'FLEET-1', locale: 'nl_NL', basename: '/' }),
    });
    const view = await renderInWidget(<Probe />, api);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toBe('nl: Gepland'));

    emit('localeChanged', { locale: 'it_IT' });

    await vi.waitFor(() => expect(view.container.textContent).toBe('it: In arrivo'));
  });
});
