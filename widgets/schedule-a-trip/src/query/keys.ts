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
 * booking lists and states, the pending regularizations, and the installation settings.
 */
export const MEMORY_QUERY_ROOTS = [
  'settings',
  'bookings',
  'customers',
  'invoices',
  'booking-states',
  'trips',
  'fleet-vehicles',
  'booking-geocoding',
  'regularizations',
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
  /** The settings the booking section reads alone (map token, radius, time zone). */
  sectionSettings: () => ['settings', 'section'] as const,
  models: (fleetId: string) => ['models', fleetId] as const,
  bookings: (fleetId: string, tab: ListTab, sort: BookingListSort) =>
    ['bookings', fleetId, tab, sort.field, sort.direction] as const,
  customers: (fleetId: string, userIds: readonly string[]) =>
    ['customers', fleetId, [...new Set(userIds)].sort()] as const,
  invoices: (fleetId: string) => ['invoices', fleetId] as const,
  invoice: (fleetId: string, invoiceId: string) => ['invoices', fleetId, invoiceId] as const,
  bookingState: (fleetId: string, bookingId: string) =>
    ['booking-states', fleetId, bookingId] as const,
  /** Every stored state of a fleet; a prefix of {@link queryKeys.bookingState}. */
  fleetBookingStates: (fleetId: string) => ['booking-states', fleetId] as const,
  /** Total of a tab, read with a page of one row. */
  bookingCount: (fleetId: string, tab: ListTab) => ['bookings', fleetId, tab, 'count'] as const,
  /** The `CONFIRMED` bookings read at once, for the Ongoing tab. */
  confirmedBookings: (fleetId: string) => ['bookings', fleetId, 'confirmed', 'all'] as const,
  booking: (fleetId: string, bookingId: string) => ['bookings', fleetId, 'one', bookingId] as const,
  tripsInProgress: (fleetId: string) => ['trips', fleetId, 'in-progress'] as const,
  /** Administrative data of the vehicles (plates, models, services): reference data. */
  vehicleCatalog: (fleetId: string) => ['plates', fleetId] as const,
  /** Live state of the vehicles: status and position, in memory only. */
  liveVehicles: (fleetId: string) => ['fleet-vehicles', fleetId] as const,
  /**
   * The address of the pickup point of a booking: where a customer is picked up is personal data,
   * kept in memory only (never under the persisted `geocoding` root).
   */
  bookingAddress: (latitude: number, longitude: number, language: string) =>
    ['booking-geocoding', latitude.toFixed(5), longitude.toFixed(5), language] as const,
  /** Addresses matching a text the operator typed: they may be a customer's, in memory only. */
  addressSearch: (text: string, language: string) =>
    ['booking-geocoding', 'search', text.trim().toLowerCase(), language] as const,
  /** Customers matching a text: personal data, in memory only. */
  customerSearch: (fleetId: string, text: string) =>
    ['customers', fleetId, 'search', text.trim().toLowerCase()] as const,
  /** The profiles of a customer and the services approved for them: in memory only. */
  registration: (fleetId: string, userId: string) =>
    ['customers', fleetId, 'registration', userId] as const,
  /** Every booking of a fleet: the prefix of `bookings`, `bookingCount`, `confirmedBookings`, `booking`. */
  fleetBookings: (fleetId: string) => ['bookings', fleetId] as const,
  pendingRegularizations: (fleetId: string) => ['regularizations', fleetId] as const,
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
