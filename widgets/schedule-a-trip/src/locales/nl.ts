import { nl } from 'date-fns/locale/nl';
import type { Catalogue, LanguagePack } from '../i18n';
import messages from './nl.json';

/** The Dutch pack, loaded on demand (`loadLanguage`). */
export const pack: LanguagePack = { messages: messages satisfies Catalogue, dateLocale: nl };
