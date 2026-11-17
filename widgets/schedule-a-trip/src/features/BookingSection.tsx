import { Alert, Box, Button, LinearProgress, Typography } from '@mui/material';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useBoClient, useBoContext } from '@vulog/bo-widget-react';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { matchesSearch } from '../domain/booking-search';
import type { ListTab } from '../domain/statuses';
import { useI18n } from '../i18n';
import { queryKeys, type BookingListSort } from '../query/keys';
import { ListGrid, type ListGridColumn } from '../ui/ListGrid';
import { queryErrorText } from './core/cards';
import { HIDDEN_CORE_COLUMNS } from './core';
import { BookingDrawer } from './detail/BookingDrawer';
import { useDetailRoute } from './detail/use-detail-route';
import type { BookingContext, BookingFeature, BookingKpi } from './extensions';
import { KpiBar } from './list/KpiBar';
import { DENSITIES, isColumnShown, useListPreferences, withColumn } from './list/preferences';
import { RowActions } from './list/RowActions';
import { headerText, SortHeader } from './list/SortHeader';
import { panelId, TabBar, tabId, useTabCounts } from './list/TabBar';
import { Toolbar } from './list/Toolbar';
import { useBookingContexts } from './list/use-booking-contexts';
import { DEFAULT_SORTS, useTabBookings } from './list/use-tab-bookings';
import { useBookingFeatures } from './registry';
import { SectionProvider, type SectionContextValue } from './section-context';
import { fleetTimeZone, useSectionSettings } from './section-settings';
import { usePlateIndex } from './use-plate-index';

const NOW_TICK_MS = 30_000;
const EMPTY_FILTERS: Readonly<Record<ListTab, readonly string[]>> = {
  alert: [],
  upcoming: [],
  ongoing: [],
  completed: [],
  cancelled: [],
};

/** The current time, every 30 seconds. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), NOW_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Props of {@link BookingSection}. */
export interface BookingSectionProps {
  /** Shown at the right of the title (the "New booking" button). */
  readonly headerActions?: ReactNode;
  /** Features added after those of the registry; keep the array stable. */
  readonly extraFeatures?: readonly BookingFeature[];
}

/**
 * The booking section: KPIs, the five tabs with their counts, the toolbar (search, filter chips,
 * density, columns, refresh), the list of the tab loaded page by page with its extra data for the
 * visible rows, the detail drawer of the booking in the URL, and the dialogs of the features. Every
 * column, action, filter, KPI and card comes from the features of the registry.
 *
 * @param props - Extra actions of the header.
 * @returns The section.
 */
export function BookingSection({ headerActions, extraFeatures }: BookingSectionProps) {
  const { t } = useI18n();
  const bo = useBoClient();
  const { fleetId: contextFleet } = useBoContext();
  const fleetId = contextFleet ?? '';
  const queryClient = useQueryClient();
  const settings = useSectionSettings();
  const now = useNow();
  const nowRef = useRef(now);
  nowRef.current = now;
  const getNow = useCallback(() => nowRef.current, []);

  const [tab, setTab] = useState<ListTab>('upcoming');
  const [sorts, setSorts] = useState(DEFAULT_SORTS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [visibleIds, setVisibleIds] = useState<ReadonlySet<string>>(new Set());
  const [preferences, setPreferences] = useListPreferences();
  const searchRef = useRef<HTMLInputElement>(null);
  const route = useDetailRoute();
  const sort = sorts[tab];

  const copyId = useCallback(
    (bookingId: string) => {
      const notify = (message: string, severity: 'success' | 'error') =>
        void bo.notify({ message, severity }).catch(() => undefined);
      if (!navigator.clipboard) {
        notify(t('action.copyFailed'), 'error');
        return;
      }
      navigator.clipboard.writeText(bookingId).then(
        () => notify(t('action.copied'), 'success'),
        () => notify(t('action.copyFailed'), 'error'),
      );
    },
    [bo, t],
  );
  const sortHeader = useCallback(
    (field: string, label: string) => (
      <SortHeader
        field={field}
        label={label}
        sort={sort}
        onSort={(next: BookingListSort) => setSorts((current) => ({ ...current, [tab]: next }))}
      />
    ),
    [sort, tab],
  );
  const features = useBookingFeatures(
    { t, openDetail: route.open, copyId, sortHeader, now: getNow },
    extraFeatures,
  );

  const tabFilters = useMemo(
    () => features.flatMap((feature) => feature.filters ?? []).filter((filter) => filter.tabs.includes(tab)),
    [features, tab],
  );
  const activeFilterIds = useMemo(() => new Set(filters[tab]), [filters, tab]);
  const activeFilters = tabFilters.filter((filter) => activeFilterIds.has(filter.id));
  const boundedTab = tab === 'alert' || tab === 'upcoming';
  const loadAll =
    activeFilters.some((filter) => filter.needsAllPages) || (deferredSearch !== '' && boundedTab);

  const tabBookings = useTabBookings(fleetId, tab, sort, loadAll);
  const enrichment = useBookingContexts({
    fleetId,
    tab,
    bookings: tabBookings.bookings,
    visibleIds,
    allCustomers: deferredSearch !== '',
  });
  const plateOf = usePlateIndex(fleetId);

  const rows = useMemo(
    () =>
      enrichment.contexts.filter(
        (ctx) =>
          activeFilters.every((filter) => filter.test(ctx)) &&
          matchesSearch(deferredSearch, {
            bookingId: ctx.booking.id,
            plate: plateOf(ctx.booking.vehicleId) ?? ctx.state?.value.preallocatedPlate ?? null,
            customerTexts: ctx.customer
              ? [ctx.customer.firstName, ctx.customer.lastName, ctx.customer.userName]
              : [],
          }),
      ),
    [enrichment.contexts, activeFilters, deferredSearch, plateOf],
  );

  // Columns of every feature, the hidden ones left out, then the actions.
  const allColumns = useMemo(
    () => features.flatMap((feature) => feature.columns?.(tab) ?? []),
    [features, tab],
  );
  const columns = useMemo<ListGridColumn<BookingContext>[]>(
    () => [
      ...allColumns.filter((column) =>
        isColumnShown(preferences.columns, column.id, HIDDEN_CORE_COLUMNS.includes(column.id)),
      ),
      {
        id: 'actions',
        header: <Box component="span" sx={visuallyHidden}>{t('column.actions')}</Box>,
        width: 'minmax(170px, auto)',
        align: 'right',
        render: (ctx) => <RowActions ctx={ctx} features={features} />,
      },
    ],
    [allColumns, preferences.columns, features, t],
  );

  const kpis = useMemo(() => features.flatMap((feature) => feature.kpis ?? []), [features]);
  const kpiCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!tabBookings.complete) return counts;
    const allFilters = features.flatMap((feature) => feature.filters ?? []);
    for (const kpi of kpis) {
      const filter = allFilters.find((candidate) => candidate.id === kpi.filterId);
      if (kpi.tab === tab && filter) counts.set(kpi.id, enrichment.contexts.filter(filter.test).length);
    }
    return counts;
  }, [kpis, features, tab, tabBookings.complete, enrichment.contexts]);
  const activeKpi =
    kpis.find(
      (kpi) => kpi.tab === tab && filters[tab].length === 1 && filters[tab][0] === kpi.filterId,
    ) ?? null;
  const selectKpi = (kpi: BookingKpi) => {
    const isActive = activeKpi?.id === kpi.id;
    setTab(kpi.tab);
    setFilters((current) => ({ ...current, [kpi.tab]: isActive ? [] : [kpi.filterId] }));
  };

  const counts = useTabCounts(fleetId);
  const refreshing = useIsFetching({ queryKey: ['bookings', fleetId] }) > 0;
  const refresh = () => {
    for (const queryKey of [
      ['bookings', fleetId],
      queryKeys.tripsInProgress(fleetId),
      queryKeys.fleetBookingStates(fleetId),
    ]) {
      void queryClient.invalidateQueries({ queryKey, exact: queryKey[0] === 'booking-states' });
    }
  };

  // `/` focuses the search, wherever the focus is but in a text field.
  useEffect(() => {
    const root = searchRef.current?.getRootNode();
    if (!(root instanceof ShadowRoot || root instanceof Document)) return undefined;
    const onKey = (event: Event) => {
      if (!(event instanceof KeyboardEvent) || event.key !== '/') return;
      const target = event.composedPath()[0];
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, []);

  const selectedIndex = rows.findIndex((ctx) => ctx.booking.id === route.selectedId);
  const neighbour = (offset: number) => {
    const next = selectedIndex < 0 ? undefined : rows[selectedIndex + offset];
    return next ? () => route.open(next.booking.id) : undefined;
  };
  const fromList = enrichment.contexts.find((ctx) => ctx.booking.id === route.selectedId);

  const { timezone: contextZone } = useBoContext();
  const timeZone = useMemo(
    () => fleetTimeZone(contextZone, settings.data?.timezone ?? null),
    [contextZone, settings.data],
  );
  const value = useMemo<SectionContextValue>(
    () => ({
      fleetId,
      timeZone,
      mapboxToken: settings.data?.mapboxToken ?? null,
      vehicleSearchRadius: settings.data?.vehicleSearchRadius ?? 500,
      now,
      customerStatus: enrichment.customerStatus,
      retryCustomers: enrichment.retryCustomers,
      statesFailed: enrichment.statesError !== null,
      openDetail: route.open,
    }),
    [
      fleetId,
      timeZone,
      settings.data,
      now,
      enrichment.customerStatus,
      enrichment.retryCustomers,
      enrichment.statesError,
      route.open,
    ],
  );

  const filtering = activeFilters.length > 0 || deferredSearch !== '';
  const empty = (
    <Box sx={{ p: 4, textAlign: 'center', display: 'grid', gap: 1, justifyItems: 'center' }}>
      <Typography color="text.secondary">
        {filtering ? t('list.noMatch') : t(`tabs.empty.${tab}`)}
      </Typography>
      {filtering && (
        <Button
          size="small"
          onClick={() => {
            setSearch('');
            setFilters((current) => ({ ...current, [tab]: [] }));
          }}
        >
          {t('list.clearFilters')}
        </Button>
      )}
    </Box>
  );

  return (
    <SectionProvider value={value}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, pt: 1.5, flex: 'none' }}>
        <Typography variant="h6" component="h1" sx={{ flex: 1 }}>
          {t('app.title')}
        </Typography>
        {headerActions}
      </Box>
      <KpiBar kpis={kpis} counts={kpiCounts} activeId={activeKpi?.id ?? null} onSelect={selectKpi} />
      <TabBar tab={tab} onChange={setTab} counts={counts} />
      <Toolbar
        search={search}
        onSearch={setSearch}
        searchRef={searchRef}
        filters={tabFilters}
        activeFilters={activeFilterIds}
        onToggleFilter={(id) =>
          setFilters((current) => ({
            ...current,
            [tab]: current[tab].includes(id)
              ? current[tab].filter((filterId) => filterId !== id)
              : [...current[tab], id],
          }))
        }
        density={preferences.density}
        onDensity={(density) => setPreferences((current) => ({ ...current, density }))}
        columns={allColumns.map((column) => {
          const hidden = HIDDEN_CORE_COLUMNS.includes(column.id);
          return {
            id: column.id,
            label: headerText(column.header, column.id),
            shown: isColumnShown(preferences.columns, column.id, hidden),
          };
        })}
        onToggleColumn={(id, shown) =>
          setPreferences((current) => ({
            ...current,
            columns: withColumn(current.columns, id, HIDDEN_CORE_COLUMNS.includes(id), shown),
          }))
        }
        updatedAt={tabBookings.updatedAt}
        now={now}
        onRefresh={refresh}
        refreshing={refreshing}
      />
      {tabBookings.progress && (
        <Box sx={{ px: 2, pb: 1, flex: 'none' }} role="status">
          <Typography variant="caption" color="text.secondary">
            {t('list.loadingAll', {
              loaded: tabBookings.progress.loaded,
              total: tabBookings.progress.total ?? '?',
            })}
          </Typography>
          <LinearProgress
            variant={tabBookings.progress.total ? 'determinate' : 'indeterminate'}
            value={
              tabBookings.progress.total
                ? (100 * tabBookings.progress.loaded) / tabBookings.progress.total
                : undefined
            }
          />
        </Box>
      )}
      {enrichment.statesError && (
        <Alert
          severity="warning"
          sx={{ flex: 'none', borderRadius: 0 }}
          action={
            <Button color="inherit" size="small" onClick={enrichment.retryStates}>
              {t('grid.retry')}
            </Button>
          }
        >
          {t('list.statesFailed')}
        </Alert>
      )}
      <Box
        component="main"
        role="tabpanel"
        id={panelId(tab)}
        aria-labelledby={tabId(tab)}
        sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        {tabBookings.error ? (
          <Alert
            severity="error"
            role="alert"
            sx={{ m: 2 }}
            action={
              <Button color="inherit" size="small" onClick={tabBookings.refetch}>
                {t('grid.retry')}
              </Button>
            }
          >
            {queryErrorText(tabBookings.error, t)}
          </Alert>
        ) : (
          <ListGrid
            key={`${fleetId}:${tab}`}
            label={t(`tabs.${tab}`)}
            columns={columns}
            rows={rows}
            getRowId={getRowId}
            rowHeight={DENSITIES[preferences.density]}
            totalCount={filtering ? rows.length : (counts[tab] ?? null)}
            isLoading={tabBookings.isLoading}
            pagination={filtering && loadAll ? undefined : tabBookings.pagination}
            onVisibleRowsChange={setVisibleIds}
            empty={empty}
            onRowActivate={route.open}
            activeRowId={route.selectedId}
          />
        )}
      </Box>
      <BookingDrawer
        bookingId={route.selectedId}
        fromList={fromList}
        features={features}
        onClose={route.close}
        onPrevious={neighbour(-1)}
        onNext={neighbour(1)}
      />
      {features.map(({ id, Host }) => (Host ? <Host key={id} /> : null))}
    </SectionProvider>
  );
}

const getRowId = (ctx: BookingContext) => ctx.booking.id;

/** Hidden from the eye, read by screen readers. */
const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;
