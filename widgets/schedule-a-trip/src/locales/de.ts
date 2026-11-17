import { de } from 'date-fns/locale/de';
import type { Catalogue, LanguagePack } from '../i18n';
import messages from './de.json';

/** The German pack, loaded on demand (`loadLanguage`). */
export const pack: LanguagePack = { messages: messages satisfies Catalogue, dateLocale: de };
