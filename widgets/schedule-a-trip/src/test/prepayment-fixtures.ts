// Test helper: neutral bookings, customers, documents and workflow dependencies for the prepayment
// feature, over the in-memory storage of the fake BO and the fake billing API.
import { connect } from '@vulog/bo-widget-sdk';
import type { ReactNode } from 'react';
import type { ScheduledBooking } from '../api/schedule-a-trip';
import type { Customer } from '../api/users';
import type { BookingContext } from '../features/extensions';
import type { MoneyDeps } from '../features/prepayment/charge';
import { parseSettings, type WidgetSettings } from '../settings';
import {
  bookingsCollection,
  BOOKINGS_COLLECTION,
  type BookingState,
  type BookingStateDoc,
} from '../storage/booking-state';
import { fakeAima } from './fake-aima';
import { fakeBo, VALID_SETTINGS } from './fake-bo';
import { renderInWidget } from './render';

/** The id of the booking of the fixtures. */
export const BOOKING_ID = 'booking-1';
/** The clock of the fixtures. */
export const NOW = new Date('2026-03-10T08:00:00.000Z');

/** A scheduled booking with neutral values: starts in 2 days for 12 hours. */
export const booking = (overrides: Partial<ScheduledBooking> = {}): ScheduledBooking => ({
  id: BOOKING_ID,
  status: 'PENDING',
  creationDate: '2026-03-01T08:00:00.000Z',
  startDate: '2026-03-12T08:00:00.000Z',
  endDate: null,
  plannedReturnDate: '2026-03-12T20:00:00.000Z',
  cancellationDate: null,
  userId: 'customer-1',
  profileId: 'profile-1',
  serviceId: 'service-1',
  modelId: 1,
  vehicleId: null,
  journeyId: null,
  completed: false,
  latitude: null,
  longitude: null,
  radius: null,
  notes: null,
  failureReason: null,
  ...overrides,
});

/** The customer of the booking, with a single profile billed to `entity-1`. */
export const customer = (type = 'Single', entityId: string | null = 'entity-1'): Customer => ({
  id: 'customer-1',
  firstName: 'Jane',
  lastName: 'Doe',
  userName: 'jane.doe',
  profiles: [{ id: 'profile-1', type, entityId }],
});

/** The valid settings of the fake BO, parsed. */
export const settings = (): WidgetSettings => {
  const parsed = parseSettings(VALID_SETTINGS);
  if (!parsed.ok) throw new Error('Invalid test settings');
  return parsed.settings;
};

/** A stored document, as the storage gives it. */
export const doc = (value: Partial<BookingState> = {}, expiresAt: string | null = null): BookingStateDoc => ({
  id: BOOKING_ID,
  version: 1,
  value: { schemaVersion: 1, fleetId: 'FLEET-1', allocationProcessed: false, ...value },
  expiresAt,
});

/** A row of the list. */
export const row = (overrides: Partial<BookingContext> = {}): BookingContext => ({
  booking: booking(),
  tab: 'upcoming',
  state: null,
  customer: customer(),
  ...overrides,
});

/**
 * The fake BO, the fake billing API and the workflow dependencies wired on them.
 *
 * @param aimaInit - The initial state of the billing API.
 */
export async function moneySetup(aimaInit: Parameters<typeof fakeAima>[0] = {}) {
  const bo = fakeBo();
  const aima = fakeAima(aimaInit);
  const client = await connect({ vulogBo: bo.api });
  const collection = bookingsCollection(client.storage);
  let clock = NOW;
  const deps: MoneyDeps = {
    authFetch: aima.authFetch,
    fleetId: 'FLEET-1',
    userId: 'operator-1',
    collection,
    now: () => clock,
    sleep: async () => undefined,
  };
  return {
    bo,
    aima,
    collection,
    deps,
    /** Moves the clock of `deps`. */
    setNow: (date: Date) => {
      clock = date;
    },
    /** Writes a document as the storage holds it (version 1). */
    seed: (value: Partial<BookingState>, id = BOOKING_ID) =>
      bo.storage.api.set(BOOKINGS_COLLECTION, id, {
        schemaVersion: 1,
        fleetId: 'FLEET-1',
        allocationProcessed: false,
        ...value,
      }),
    /** The stored document. */
    stored: (id = BOOKING_ID) => bo.storage.docs(BOOKINGS_COLLECTION).get(id),
    disconnect: () => client.disconnect(),
  };
}

/**
 * Renders a component of the feature in the widget providers, over the fake BO (settings in EUR)
 * and the fake billing API answering `fetch`.
 *
 * @param ui - The element.
 * @param options - Overrides of the fake BO, initial billing state and stored documents.
 */
export async function renderWithBilling(
  ui: ReactNode,
  options: {
    bo?: Record<string, unknown>;
    aima?: Parameters<typeof fakeAima>[0];
    stored?: Partial<BookingState>;
  } = {},
) {
  const bo = fakeBo({ getSettings: async () => ({ ...VALID_SETTINGS, currency: 'EUR' }), ...options.bo });
  const aima = fakeAima(options.aima);
  aima.stubFetch();
  if (options.stored) {
    await bo.storage.api.set(BOOKINGS_COLLECTION, BOOKING_ID, {
      schemaVersion: 1,
      fleetId: 'FLEET-1',
      allocationProcessed: false,
      ...options.stored,
    });
    bo.storage.api.set.mockClear();
  }
  const view = await renderInWidget(ui, bo.api);
  return { bo, aima, view, stored: () => bo.storage.docs(BOOKINGS_COLLECTION).get(BOOKING_ID) };
}
