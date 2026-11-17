import { fr } from 'date-fns/locale/fr';
import type { Catalogue, LanguagePack } from '../i18n';
import messages from './fr.json';

/** The French pack, loaded on demand (`loadLanguage`). */
export const pack: LanguagePack = { messages: messages satisfies Catalogue, dateLocale: fr };
