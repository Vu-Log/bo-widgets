import { es } from 'date-fns/locale/es';
import type { Catalogue, LanguagePack } from '../i18n';
import messages from './es.json';

/** The Spanish pack, loaded on demand (`loadLanguage`). */
export const pack: LanguagePack = { messages: messages satisfies Catalogue, dateLocale: es };
