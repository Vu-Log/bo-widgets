import { useBoContext } from '@vulog/bo-widget-react';
import { format, formatDistance, type Locale } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type enMessages from './locales/en.json';
import { pack as ENGLISH } from './locales/en.ts';

/** The languages of the widget; English is the source and the fallback. */
export const LANGUAGES = ['en', 'de', 'fr', 'it', 'nl', 'es', 'pt', 'hu'] as const;

/** A language of the widget. */
export type Language = (typeof LANGUAGES)[number];

/** A key of the message catalogues (`src/locales/en.json` is the source). */
export type MessageKey = keyof typeof enMessages;

/** Values of the `{param}` placeholders of a message. */
export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * A catalogue: every key of the English one. Each `src/locales/<language>.ts` checks its JSON with
 * `satisfies Catalogue`, so the type check refuses a missing key; the test of `i18n.test.tsx`
 * refuses extra keys.
 */
export type Catalogue = Readonly<Record<MessageKey, string>>;

/** What a language needs: its catalogue and its date-fns locale, loaded together. */
export interface LanguagePack {
  readonly messages: Catalogue;
  readonly dateLocale: Locale;
  /** date-fns locales of the full BO locales that have their own variant (`pt_br`). */
  readonly regionalDateLocales?: Readonly<Record<string, Locale>>;
}

/** A language other than English: its pack is a chunk of its own, loaded on demand. */
export type LoadableLanguage = Exclude<Language, 'en'>;

/**
 * The loader of each language pack. Literal `import()` calls, one per language, so that the bundle
 * has one chunk per language (its catalogue and its date-fns locale); English stays in `index.js`.
 */
export const LANGUAGE_LOADERS: Readonly<
  Record<LoadableLanguage, () => Promise<{ readonly pack: LanguagePack }>>
> = {
  de: () => import('./locales/de.ts'),
  fr: () => import('./locales/fr.ts'),
  it: () => import('./locales/it.ts'),
  nl: () => import('./locales/nl.ts'),
  es: () => import('./locales/es.ts'),
  pt: () => import('./locales/pt.ts'),
  hu: () => import('./locales/hu.ts'),
};

/** Where the pack of a language stands. `idle`: never asked for. */
export type LanguageStatus = 'idle' | 'loading' | 'loaded' | 'failed';

/** The pack of a language could not be loaded (network, CDN): the widget stays in English. */
export class LanguageLoadError extends Error {
  readonly language: Language;

  constructor(language: Language, cause: unknown) {
    super(`The ${language} texts could not be loaded`, { cause });
    this.name = 'LanguageLoadError';
    this.language = language;
  }
}

const packs = new Map<Language, LanguagePack>([['en', ENGLISH]]);
const loading = new Map<Language, Promise<LanguagePack>>();
const failures = new Map<Language, LanguageLoadError>();
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Where the pack of a language stands.
 *
 * @param language - The language.
 * @returns Its status; English is always `loaded`.
 */
export function languageStatus(language: Language): LanguageStatus {
  if (packs.has(language)) return 'loaded';
  if (loading.has(language)) return 'loading';
  return failures.has(language) ? 'failed' : 'idle';
}

/**
 * Why the last load of a language failed.
 *
 * @param language - The language.
 * @returns The failure, `null` unless its status is `failed`.
 */
export const languageError = (language: Language): LanguageLoadError | null =>
  failures.get(language) ?? null;

/**
 * Loads the pack of a language once; a load in progress is shared. A failure is not kept as the
 * result: the next call tries again (the Retry of `LanguageStatusBanner`).
 *
 * @param language - The language.
 * @returns The pack.
 * @throws {LanguageLoadError} When its chunk cannot be loaded.
 */
export function loadLanguage(language: Language): Promise<LanguagePack> {
  const loaded = packs.get(language);
  if (loaded) return Promise.resolve(loaded);
  const pending = loading.get(language);
  if (pending) return pending;
  if (language === 'en') return Promise.resolve(ENGLISH);
  const promise = LANGUAGE_LOADERS[language]().then(
    ({ pack }) => {
      loading.delete(language);
      failures.delete(language);
      packs.set(language, pack);
      notify();
      return pack;
    },
    (cause: unknown) => {
      loading.delete(language);
      const error = new LanguageLoadError(language, cause);
      failures.set(language, error);
      notify();
      throw error;
    },
  );
  failures.delete(language);
  loading.set(language, promise);
  notify();
  return promise;
}

/**
 * Forgets the packs loaded and the failures, English excepted. For tests only.
 */
export function resetLanguagesForTests(): void {
  packs.clear();
  packs.set('en', ENGLISH);
  loading.clear();
  failures.clear();
  notify();
}

/**
 * The status of the pack of a language, following its loads.
 *
 * @param language - The language.
 * @returns Its status.
 */
export function useLanguageStatus(language: Language): LanguageStatus {
  return useSyncExternalStore(subscribe, () => languageStatus(language));
}

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
 * left as it is, so that a missing value shows instead of vanishing. A language whose pack is not
 * loaded speaks English.
 *
 * @param language - The language.
 * @param key - The key of the message.
 * @param params - The values of its placeholders.
 * @returns The message.
 */
export function translate(language: Language, key: MessageKey, params?: MessageParams): string {
  const message = (packs.get(language) ?? ENGLISH).messages[key];
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
 * Translation and formatting for a BO locale, with the packs loaded so far: until the pack of its
 * language is loaded ({@link loadLanguage}), the texts and the dates are in English.
 *
 * @param boLocale - `getContext().locale` (`en_GB`, `fr_FR`…), `null` when unknown.
 * @returns The language shown, the `Intl` locale, `t` and the formatters.
 */
export function createI18n(boLocale: string | null): I18n {
  const requested = resolveLanguage(boLocale);
  const pack = packs.get(requested);
  const language = pack ? requested : 'en';
  const active = pack ?? ENGLISH;
  const locale = bcp47(boLocale, language);
  const dateLocale = active.regionalDateLocales?.[normalize(boLocale ?? '')] ?? active.dateLocale;
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
 * Translation and formatting in the locale of the back office, following `localeChanged`. It asks
 * for the pack of the language once and speaks English until it arrives, so that the shell shows
 * and the requests start at once; every component switches together when it is loaded. A failed
 * load is shown, logged and retried by `LanguageStatusBanner`, not here.
 *
 * @returns {@link createI18n} for the current BO locale.
 */
export function useI18n(): I18n {
  const { locale } = useBoContext();
  const requested = resolveLanguage(locale);
  const status = useLanguageStatus(requested);
  useEffect(() => {
    // The failure is kept in the store, where the banner of `App` reads it.
    if (languageStatus(requested) === 'idle') loadLanguage(requested).catch(() => undefined);
  }, [requested]);
  // `createI18n` reads the packs loaded: build it again when the one of this language arrives.
  const loaded = status === 'loaded';
  return useMemo(() => createI18n(locale), [locale, loaded]);
}
