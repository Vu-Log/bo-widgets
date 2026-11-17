import { createContext, useContext, type ReactNode } from 'react';
import type { CustomerStatus } from './list/use-booking-contexts';

/** What the cells and cards of the section read besides their booking. */
export interface SectionContextValue {
  readonly fleetId: string;
  /** Time zone of the fleet; `null` for the browser's. */
  readonly timeZone: string | null;
  readonly mapboxToken: string | null;
  /** Default radius of the vehicle search, in meters. */
  readonly vehicleSearchRadius: number;
  /** The current time, refreshed every 30 seconds for the relative dates. */
  readonly now: Date;
  readonly customerStatus: (userId: string | null) => CustomerStatus;
  readonly retryCustomers: () => void;
  /** The stored states could not be listed: what depends on them shows a dash, not a skeleton. */
  readonly statesFailed: boolean;
  readonly openDetail: (bookingId: string) => void;
}

const SectionContext = createContext<SectionContextValue | null>(null);

/**
 * Gives the cells and the cards of the section their shared data.
 *
 * @param props - The value and the section.
 * @returns The provider.
 */
export function SectionProvider({
  value,
  children,
}: {
  readonly value: SectionContextValue;
  readonly children: ReactNode;
}) {
  return <SectionContext.Provider value={value}>{children}</SectionContext.Provider>;
}

/**
 * The shared data of the section.
 *
 * @returns The value of the nearest {@link SectionProvider}.
 * @throws {Error} Outside a {@link SectionProvider}.
 */
export function useSection(): SectionContextValue {
  const value = useContext(SectionContext);
  if (value === null) throw new Error('useSection must be used inside a SectionProvider');
  return value;
}
