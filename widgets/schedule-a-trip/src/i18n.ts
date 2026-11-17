import { useBoContext } from '@vulog/bo-widget-react';
import type { ListTab } from './domain/statuses';

/** The texts of the widget in one language. */
export interface Messages {
  readonly title: string;
  readonly tabsLabel: string;
  readonly tabs: Readonly<Record<ListTab, string>>;
  readonly emptyTab: Readonly<Record<ListTab, string>>;
  readonly configurationIncomplete: string;
  readonly configurationIncompleteDetails: string;
  readonly settingsUnavailable: string;
  readonly loading: string;
}

const en: Messages = {
  title: 'Schedule a trip',
  tabsLabel: 'Bookings',
  tabs: {
    alert: 'Alert',
    upcoming: 'Upcoming',
    ongoing: 'Ongoing',
    completed: 'Completed',
    cancelled: 'Cancelled',
  },
  emptyTab: {
    alert: 'No booking in alert.',
    upcoming: 'No upcoming booking.',
    ongoing: 'No ongoing booking.',
    completed: 'No completed booking.',
    cancelled: 'No cancelled booking.',
  },
  configurationIncomplete: 'Configuration incomplete',
  configurationIncompleteDetails:
    'The prepayment actions are disabled. An administrator must fix these settings of the widget in Configuration > Widgets:',
  settingsUnavailable: 'The settings of the widget could not be loaded.',
  loading: 'Loading…',
};

const fr: Messages = {
  title: 'Schedule a trip',
  tabsLabel: 'Réservations',
  tabs: {
    alert: 'Alerte',
    upcoming: 'À venir',
    ongoing: 'En cours',
    completed: 'Terminées',
    cancelled: 'Annulées',
  },
  emptyTab: {
    alert: 'Aucune réservation en alerte.',
    upcoming: 'Aucune réservation à venir.',
    ongoing: 'Aucune réservation en cours.',
    completed: 'Aucune réservation terminée.',
    cancelled: 'Aucune réservation annulée.',
  },
  configurationIncomplete: 'Configuration incomplète',
  configurationIncompleteDetails:
    'Les actions de prépaiement sont désactivées. Un administrateur doit corriger ces réglages du widget dans Configuration > Widgets :',
  settingsUnavailable: 'Les réglages du widget n’ont pas pu être chargés.',
  loading: 'Chargement…',
};

/**
 * The texts for a back office locale (`fr_FR`, `en_GB`…): French for any `fr` locale, English
 * otherwise.
 *
 * @param locale - `getContext().locale`, `null` when unknown.
 * @returns The texts.
 */
export const messagesFor = (locale: string | null): Messages =>
  locale?.toLowerCase().startsWith('fr') ? fr : en;

/**
 * The texts in the locale of the back office, following `localeChanged`.
 *
 * @returns The texts.
 */
export function useMessages(): Messages {
  return messagesFor(useBoContext().locale);
}
