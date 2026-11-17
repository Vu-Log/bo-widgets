// Test helpers: renders a part of the booking section with its shared data.
import type { ReactNode } from 'react';
import type { ScheduledBooking } from '../api/schedule-a-trip';
import type { BookingContext } from '../features/extensions';
import { SectionProvider, type SectionContextValue } from '../features/section-context';
import type { BookingStateDoc } from '../storage/booking-state';
import { fakeBo } from './fake-bo';
import { renderInWidget } from './render';
import { apiBooking } from './vulog-api';

/** Shared data of the section, with neutral values. */
export const sectionValue = (overrides: Partial<SectionContextValue> = {}): SectionContextValue => ({
  fleetId: 'FLEET-1',
  timeZone: 'UTC',
  mapboxToken: null,
  vehicleSearchRadius: 500,
  now: new Date('2026-03-10T08:00:00Z'),
  customerStatus: () => 'ok',
  retryCustomers: () => undefined,
  statesFailed: false,
  openDetail: () => undefined,
  ...overrides,
});

/** A booking as the API module gives it (every field read). */
export const booking = (overrides: Record<string, unknown> = {}): ScheduledBooking =>
  apiBooking(overrides) as ScheduledBooking;

/** A stored state document. */
export const stateDoc = (value: Record<string, unknown> = {}, version = 1): BookingStateDoc => ({
  id: 'booking-1',
  version,
  expiresAt: null,
  value: { schemaVersion: 1, fleetId: 'FLEET-1', allocationProcessed: false, ...value },
});

/** The context of a row. */
export const context = (overrides: Partial<BookingContext> = {}): BookingContext => ({
  booking: booking(),
  tab: 'upcoming',
  state: null,
  customer: {
    id: 'user-1',
    firstName: 'Jane',
    lastName: 'Doe',
    userName: 'jane.doe',
    profiles: [{ id: 'profile-1', type: 'Single', entityId: null }],
  },
  ...overrides,
});

/**
 * Renders `ui` in the widget providers and a `SectionProvider`.
 *
 * @param ui - What to render.
 * @param options - The fake BO and the shared data.
 * @returns What `renderInWidget` returns.
 */
export function renderInSection(
  ui: ReactNode,
  options: { api?: object; value?: Partial<SectionContextValue> } = {},
) {
  return renderInWidget(
    <SectionProvider value={sectionValue(options.value)}>{ui}</SectionProvider>,
    options.api ?? fakeBo().api,
  );
}
