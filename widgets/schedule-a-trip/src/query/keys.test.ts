import { describe, expect, it } from 'vitest';
import { isPersistedQueryKey, MEMORY_QUERY_ROOTS, PERSISTED_QUERY_ROOTS, queryKeys } from './keys';

describe('queryKeys', () => {
  it('starts each key with its root', () => {
    const sort = { field: 'startDate', direction: 'ASC' } as const;
    expect(queryKeys.settings()).toEqual(['settings']);
    expect(queryKeys.models('FLEET-1')).toEqual(['models', 'FLEET-1']);
    expect(queryKeys.bookings('FLEET-1', 'upcoming', sort)).toEqual([
      'bookings',
      'FLEET-1',
      'upcoming',
      'startDate',
      'ASC',
    ]);
    expect(queryKeys.invoice('FLEET-1', 'invoice-1')).toEqual(['invoices', 'FLEET-1', 'invoice-1']);
    expect(queryKeys.bookingState('FLEET-1', 'booking-1')).toEqual([
      'booking-states',
      'FLEET-1',
      'booking-1',
    ]);
    expect(queryKeys.pendingRegularizations('FLEET-1')).toEqual(['regularizations', 'FLEET-1']);
    expect(isPersistedQueryKey(queryKeys.pendingRegularizations('FLEET-1'))).toBe(false);
  });

  it('gives the same customers key whatever the order of the ids', () => {
    expect(queryKeys.customers('FLEET-1', ['b', 'a'])).toEqual(
      queryKeys.customers('FLEET-1', ['a', 'b']),
    );
  });

  it('gives the same customers key with or without duplicates', () => {
    expect(queryKeys.customers('FLEET-1', ['a', 'a', 'b'])).toEqual(
      queryKeys.customers('FLEET-1', ['b', 'a']),
    );
  });

  it('does not change the ids given', () => {
    const ids = ['b', 'a'];
    queryKeys.customers('FLEET-1', ids);
    expect(ids).toEqual(['b', 'a']);
  });
});

describe('isPersistedQueryKey', () => {
  it('allows the reference data only', () => {
    for (const root of PERSISTED_QUERY_ROOTS)
      expect(isPersistedQueryKey([root, 'FLEET-1'])).toBe(true);
  });

  it('never allows personal data, payment statuses, lists, states or settings', () => {
    for (const root of MEMORY_QUERY_ROOTS)
      expect(isPersistedQueryKey([root, 'FLEET-1'])).toBe(false);
    expect(isPersistedQueryKey(queryKeys.customers('FLEET-1', ['user-1']))).toBe(false);
    expect(isPersistedQueryKey(queryKeys.invoice('FLEET-1', 'invoice-1'))).toBe(false);
    expect(isPersistedQueryKey(queryKeys.settings())).toBe(false);
  });

  it('never allows an unknown or empty key', () => {
    expect(isPersistedQueryKey(['users'])).toBe(false);
    expect(isPersistedQueryKey([])).toBe(false);
    expect(isPersistedQueryKey([{ root: 'models' }])).toBe(false);
  });

  it('keeps the two lists apart', () => {
    const persisted: readonly string[] = PERSISTED_QUERY_ROOTS;
    expect(MEMORY_QUERY_ROOTS.filter((root) => persisted.includes(root))).toEqual([]);
  });
});
