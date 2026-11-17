import type { QueryKey } from '@tanstack/react-query';
import type { ListTab } from '../domain/statuses';

/**
 * Roots of the query keys whose data may be persisted in the browser between two openings of the
 * widget: reference data that changes rarely and holds nothing personal.
 */
export const PERSISTED_QUERY_ROOTS = [
  'models',
  'services',
  'cities',
  'plates',
  'geocoding',
  'fleet-config',
] as const;

/**
 * Roots of the query keys kept in memory only: personal data (customers), payment statuses, the
 * booking lists and states, and the installation settings.
 */
export const MEMORY_QUERY_ROOTS = [
  'settings',
  'bookings',
  'customers',
  'invoices',
  'booking-states',
] as const;

/** A root of a query key whose data may be persisted. */
export type PersistedQueryRoot = (typeof PERSISTED_QUERY_ROOTS)[number];
/** A root of a query key whose data stays in memory. */
export type MemoryQueryRoot = (typeof MEMORY_QUERY_ROOTS)[number];

/** Sort of a booking list: a field of the booking and a direction. */
export interface BookingListSort {
  readonly field: string;
  readonly direction: 'ASC' | 'DESC';
}

/**
 * The query keys of the widget. Build every key here: the first element decides whether the data
 * may be persisted ({@link isPersistedQueryKey}).
 */
export const queryKeys = {
  settings: () => ['settings'] as const,
  models: (fleetId: string) => ['models', fleetId] as const,
  bookings: (fleetId: string, tab: ListTab, sort: BookingListSort) =>
    ['bookings', fleetId, tab, sort.field, sort.direction] as const,
  customers: (fleetId: string, userIds: readonly string[]) =>
    ['customers', fleetId, [...userIds].sort()] as const,
  invoice: (fleetId: string, invoiceId: string) => ['invoices', fleetId, invoiceId] as const,
  bookingState: (fleetId: string, bookingId: string) =>
    ['booking-states', fleetId, bookingId] as const,
} satisfies Record<
  string,
  (...args: never[]) => readonly [PersistedQueryRoot | MemoryQueryRoot, ...unknown[]]
>;

/**
 * Whether the data of a query may be written to the browser storage. Only keys whose root is in
 * {@link PERSISTED_QUERY_ROOTS}: any other key, including an unknown one, stays in memory.
 *
 * @param queryKey - The key of the query.
 * @returns `true` for persisted reference data only.
 */
export function isPersistedQueryKey(queryKey: QueryKey): boolean {
  const root = queryKey[0];
  return typeof root === 'string' && (PERSISTED_QUERY_ROOTS as readonly string[]).includes(root);
}
