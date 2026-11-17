import { describe, expect, it } from 'vitest';
import { LIST_TABS } from './domain/statuses';
import { messagesFor } from './i18n';

describe('messagesFor', () => {
  it('speaks French for a French locale', () => {
    expect(messagesFor('fr_FR').tabs.upcoming).toBe('À venir');
    expect(messagesFor('fr_CA').configurationIncomplete).toBe('Configuration incomplète');
  });

  it('speaks English otherwise', () => {
    expect(messagesFor('en_GB').tabs.upcoming).toBe('Upcoming');
    expect(messagesFor('de_DE').tabs.alert).toBe('Alert');
    expect(messagesFor(null).title).toBe('Schedule a trip');
  });

  it('names every tab in both languages', () => {
    for (const locale of ['en_GB', 'fr_FR']) {
      const messages = messagesFor(locale);
      for (const tab of LIST_TABS) {
        expect(messages.tabs[tab]).not.toBe('');
        expect(messages.emptyTab[tab]).not.toBe('');
      }
    }
  });
});
