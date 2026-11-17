import { enGB } from 'date-fns/locale/en-GB';
import type { LanguagePack } from '../i18n';
import messages from './en.json';

/** The English pack: the source of the keys and the fallback, bundled in `index.js`. */
export const pack: LanguagePack = { messages, dateLocale: enGB };
