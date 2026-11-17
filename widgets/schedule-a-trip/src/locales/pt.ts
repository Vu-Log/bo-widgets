import { pt } from 'date-fns/locale/pt';
import { ptBR } from 'date-fns/locale/pt-BR';
import type { Catalogue, LanguagePack } from '../i18n';
import messages from './pt.json';

/** The Portuguese pack, loaded on demand (`loadLanguage`): Brazilian dates for `pt_BR`. */
export const pack: LanguagePack = {
  messages: messages satisfies Catalogue,
  dateLocale: pt,
  regionalDateLocales: { pt_br: ptBR },
};
