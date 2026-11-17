import { useMemo } from 'react';
import { createCoreFeature, type CoreFeatureDeps } from './core';
import type { BookingFeature } from './extensions';

/** What the features of the section need from it. */
export type FeatureDeps = CoreFeatureDeps;

/**
 * The features of the booking section, in order: the order of their columns, of their cards of the
 * same `order`, and of the primary actions (the first non-null one of a row wins).
 *
 * Register a feature here, once:
 * 1. `core`: the booking data, its filters and cards;
 * 2. the prepayment feature (`features/prepayment`), when it is merged: before the write actions, so
 *    that "Prepay" stays the primary action of a booking to prepay.
 *
 * @param deps - Translation, navigation and sort of the section.
 * @param extra - Features added after those of the registry (a widget built on this one, a test);
 *   keep the array stable.
 * @returns The features.
 */
export function useBookingFeatures(
  deps: FeatureDeps,
  extra: readonly BookingFeature[] = NO_FEATURES,
): readonly BookingFeature[] {
  const { t, openDetail, copyId, sortHeader, now } = deps;
  return useMemo(
    () => [createCoreFeature({ t, openDetail, copyId, sortHeader, now }), ...extra],
    [t, openDetail, copyId, sortHeader, now, extra],
  );
}

const NO_FEATURES: readonly BookingFeature[] = [];
