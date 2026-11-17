import { hu } from 'date-fns/locale/hu';
import type { Catalogue, LanguagePack } from '../i18n';
import messages from './hu.json';

/** The Hungarian pack, loaded on demand (`loadLanguage`). */
export const pack: LanguagePack = { messages: messages satisfies Catalogue, dateLocale: hu };
