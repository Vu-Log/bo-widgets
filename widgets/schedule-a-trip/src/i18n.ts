import { useBoContext } from '@vulog/bo-widget-react';
import { format, formatDistance, type Locale } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { de, enGB, es, fr, hu, it, nl, pt, ptBR } from 'date-fns/locale';
import { useMemo } from 'react';
import deMessages from './locales/de.json';
import enMessages from './locales/en.json';
import esMessages from './locales/es.json';
import frMessages from './locales/fr.json';
import huMessages from './locales/hu.json';
import itMessages from './locales/it.json';
import nlMessages from './locales/nl.json';
import ptMessages from './locales/pt.json';

/** The languages of the widget; English is the source and the fallback. */
export const LANGUAGES = ['en', 'de', 'fr', 'it', 'nl', 'es', 'pt', 'hu'] as const;

/** A language of the widget. */
export type Language = (typeof LANGUAGES)[number];

/** A key of the message catalogues (`src/locales/en.json` is the source). */
export type MessageKey = keyof typeof enMessages;

/** Values of the `{param}` placeholders of a message. */
export type MessageParams = Readonly<Record<string, string | number>>;

/** A catalogue: every key of the English one. The test of `i18n.test.ts` refuses extra keys. */
type Catalogue = Readonly<Record<MessageKey, string>>;

/** The message catalogues, one per language. */
export const CATALOGUES: Readonly<Record<Language, Catalogue>> = {
  en: enMessages,
  de: deMessages satisfies Catalogue,
  fr: frMessages satisfies Catalogue,
  it: itMessages satisfies Catalogue,
  nl: nlMessages satisfies Catalogue,
  es: esMessages satisfies Catalogue,
  pt: ptMessages satisfies Catalogue,
  hu: huMessages satisfies Catalogue,
};

const DATE_LOCALES: Readonly<Record<Language, Locale>> = { en: enGB, de, fr, it, nl, es, pt, hu };
/** date-fns locales for a full BO locale whose language has several variants. */
const DATE_LOCALES_BY_LOCALE: Readonly<Record<string, Locale>> = { pt_br: ptBR };

const PLACEHOLDER = /\{(\w+)\}/g;

const isLanguage = (value: string): value is Language =>
  (LANGUAGES as readonly string[]).includes(value);

const normalize = (locale: string): string => locale.trim().replace('-', '_').toLowerCase();

/**
 * The language of a BO locale (`de_DE`, `fr_FR`, `pt_BR`…): the full locale when a catalogue has
 * that name, then its language, then English.
 *
 * @param boLocale - `getContext().locale`, `null` when unknown.
 * @returns The language of the catalogue to use.
 */
export function resolveLanguage(boLocale: string | null): Language {
  if (!boLocale) return 'en';
  const full = normalize(boLocale);
  if (isLanguage(full)) return full;
  const language = full.split('_')[0] ?? '';
  return isLanguage(language) ? language : 'en';
}

/**
 * The placeholders of a message, sorted.
 *
 * @param message - A message of a catalogue.
 * @returns The names between braces, once each.
 */
export const placeholdersOf = (message: string): string[] =>
  [...new Set([...message.matchAll(PLACEHOLDER)].map((match) => match[1] ?? ''))].sort();

/**
 * A message in a language, its `{param}` placeholders replaced. A placeholder without a value is
 * left as it is, so that a missing value shows instead of vanishing.
 *
 * @param language - The language.
 * @param key - The key of the message.
 * @param params - The values of its placeholders.
 * @returns The message.
 */
export function translate(language: Language, key: MessageKey, params?: MessageParams): string {
  const message = CATALOGUES[language][key];
  if (!params) return message;
  return message.replace(PLACEHOLDER, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}

/** Translation and formatting for one BO locale. */
export interface I18n {
  readonly language: Language;
  /** BCP 47 tag for `Intl` (`de-DE`), the language when the BO locale is not a valid one. */
  readonly locale: string;
  readonly t: (key: MessageKey, params?: MessageParams) => string;
  readonly formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  /** An amount in a currency (ISO 4217 code). */
  readonly formatCurrency: (amount: number, currency: string) => string;
  /** A date with a date-fns pattern (`PPp`…), in the locale of the BO. */
  readonly formatDate: (date: Date, pattern: string) => string;
  /**
   * A date with a date-fns pattern in a time zone (the fleet's), in the locale of the BO; in the
   * time zone of the browser when `timeZone` is `null`.
   */
  readonly formatDateInZone: (date: Date, pattern: string, timeZone: string | null) => string;
  /** How far a date is from now, in words: "in 2 hours", "3 days ago". */
  readonly formatRelative: (date: Date, now: Date) => string;
}

const bcp47 = (boLocale: string | null, language: Language): string => {
  if (!boLocale) return language;
  try {
    return Intl.getCanonicalLocales(boLocale.trim().replace('_', '-'))[0] ?? language;
  } catch (error) {
    if (error instanceof RangeError) return language;
    throw error;
  }
};

/**
 * Translation and formatting for a BO locale.
 *
 * @param boLocale - `getContext().locale` (`en_GB`, `fr_FR`…), `null` when unknown.
 * @returns The language, the `Intl` locale, `t` and the formatters.
 */
export function createI18n(boLocale: string | null): I18n {
  const language = resolveLanguage(boLocale);
  const locale = bcp47(boLocale, language);
  const dateLocale = DATE_LOCALES_BY_LOCALE[normalize(boLocale ?? '')] ?? DATE_LOCALES[language];
  return {
    language,
    locale,
    t: (key, params) => translate(language, key, params),
    formatNumber: (value, options) => new Intl.NumberFormat(locale, options).format(value),
    formatCurrency: (amount, currency) =>
      new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount),
    formatDate: (date, pattern) => format(date, pattern, { locale: dateLocale }),
    formatDateInZone: (date, pattern, timeZone) =>
      timeZone === null
        ? format(date, pattern, { locale: dateLocale })
        : formatInTimeZone(date, timeZone, pattern, { locale: dateLocale }),
    formatRelative: (date, now) =>
      formatDistance(date, now, { addSuffix: true, locale: dateLocale }),
  };
}

/**
 * Translation and formatting in the locale of the back office, following `localeChanged`.
 *
 * @returns {@link createI18n} for the current BO locale.
 */
export function useI18n(): I18n {
  const { locale } = useBoContext();
  return useMemo(() => createI18n(locale), [locale]);
}
