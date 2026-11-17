import { it } from 'date-fns/locale/it';
import type { Catalogue, LanguagePack } from '../i18n';
import messages from './it.json';

/** The Italian pack, loaded on demand (`loadLanguage`). */
export const pack: LanguagePack = { messages: messages satisfies Catalogue, dateLocale: it };
