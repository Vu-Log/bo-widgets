import { useBoClient } from '@vulog/bo-widget-react';
import { useEffect, useMemo } from 'react';
import { LIST_TABS } from '../domain/statuses';
import { createCoreFeature, type CoreFeatureDeps } from './core';
import type { BookingFeature } from './extensions';

/**
 * The rules of the extension point that its types cannot express: unique ids within each kind
 * (features, columns of a tab, filters, KPIs, cards), and a KPI naming a filter that applies to its
 * tab.
 *
 * @param features - The features of the registry.
 * @returns The broken rules, as sentences; none when the features are consistent.
 */
export function validateFeatures(features: readonly BookingFeature[]): string[] {
  const problems: string[] = [];
  const unique = (kind: string, ids: readonly string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) problems.push(`Duplicate ${kind} id: ${id}`);
      seen.add(id);
    }
  };
  unique('feature', features.map((feature) => feature.id));
  for (const tab of LIST_TABS) {
    unique(`column (${tab})`, features.flatMap((feature) => feature.columns?.(tab) ?? []).map((c) => c.id));
  }
  const filters = features.flatMap((feature) => feature.filters ?? []);
  unique('filter', filters.map((filter) => filter.id));
  const kpis = features.flatMap((feature) => feature.kpis ?? []);
  unique('KPI', kpis.map((kpi) => kpi.id));
  unique('detail card', features.flatMap((feature) => feature.detailCards ?? []).map((card) => card.id));
  for (const kpi of kpis) {
    const filter = filters.find((candidate) => candidate.id === kpi.filterId);
    if (!filter) problems.push(`KPI ${kpi.id} names an unknown filter: ${kpi.filterId}`);
    else if (!filter.tabs.includes(kpi.tab)) {
      problems.push(`KPI ${kpi.id} is on ${kpi.tab}, where its filter ${filter.id} does not apply`);
    }
  }
  return problems;
}

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
  const bo = useBoClient();
  const features = useMemo(
    () => [createCoreFeature({ t, openDetail, copyId, sortHeader, now }), ...extra],
    [t, openDetail, copyId, sortHeader, now, extra],
  );
  const problems = useMemo(() => validateFeatures(features), [features]);
  useEffect(() => {
    if (problems.length > 0) bo.log.error('The booking features break the extension point', { problems });
  }, [bo, problems]);
  return features;
}

const NO_FEATURES: readonly BookingFeature[] = [];
