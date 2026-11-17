import { Button } from '@mui/material';
import { useBoClient } from '@vulog/bo-widget-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { LIST_TABS } from '../domain/statuses';
import { createCoreFeature, type CoreFeatureDeps } from './core';
import type { BookingFeature } from './extensions';
import { createWriteFeature } from './write';
import { createDialogStore } from './write/store';

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

/**
 * The bookings a filter finds by itself, when the pages of its tab may not hold them (a query of
 * the storage, for instance): the section reads them by id and adds them to the rows of the tab
 * while the filter is active.
 */
export interface FilterSource {
  /** The filter (of the same feature) these bookings are for. */
  readonly filterId: string;
  /** Their ids; `undefined` while they load. */
  readonly bookingIds: readonly string[] | undefined;
}

/**
 * A feature of the section: the shared contract (`extensions.ts`), plus what only the section reads.
 * Build it in a hook (`useXFeature()`), so that its labels follow the language of the back office
 * and it can read its own queries.
 */
export type SectionFeature = BookingFeature & {
  readonly filterSources?: readonly FilterSource[];
};

/** What the features of the section need from it. */
export type FeatureDeps = CoreFeatureDeps;

/**
 * The features of the booking section, in order: the order of their columns, of their cards of the
 * same `order`, and of the primary actions (the first non-null one of a row wins).
 *
 * Register a feature here, once:
 * 1. `core`: the booking data, its filters and cards;
 * 2. the prepayment feature (`features/prepayment`), when it is merged: before the write actions, so
 *    that "Prepay" stays the primary action of a booking to prepay;
 * 3. `write`: create, edit, cancel, allocate and pre-allocate.
 *
 * @param deps - Translation, navigation and sort of the section.
 * @param extra - Features added after those of the registry (a widget built on this one, a test);
 *   keep the array stable.
 * @returns The features, and the actions of the header (the "New booking" button).
 */
export function useBookingFeatures(
  deps: FeatureDeps,
  extra: readonly SectionFeature[] = NO_FEATURES,
): { readonly features: readonly SectionFeature[]; readonly headerActions: ReactNode } {
  const { t, openDetail, copyId, sortHeader, now } = deps;
  const bo = useBoClient();
  const [store] = useState(createDialogStore);
  // A feature built by a hook goes here, before the write feature:
  // const prepayment = usePrepaymentFeature();
  const features = useMemo<readonly SectionFeature[]>(
    () => [
      createCoreFeature({ t, openDetail, copyId, sortHeader, now }),
      createWriteFeature({ t, store, now }),
      ...extra,
    ],
    [t, openDetail, copyId, sortHeader, now, extra, store],
  );
  const problems = useMemo(() => validateFeatures(features), [features]);
  useEffect(() => {
    if (problems.length > 0) bo.log.error('The booking features break the extension point', { problems });
  }, [bo, problems]);
  const headerActions = useMemo(
    () => (
      <Button variant="contained" onClick={() => store.open({ kind: 'create' })}>
        {t('create.open')}
      </Button>
    ),
    [store, t],
  );
  return { features, headerActions };
}

const NO_FEATURES: readonly SectionFeature[] = [];
