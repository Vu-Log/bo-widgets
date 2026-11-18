import { differenceInHours } from 'date-fns';
import type { ReactNode } from 'react';
import type { ListTab } from '../../domain/statuses';
import type { MessageKey, MessageParams } from '../../i18n';
import type { BookingColumn, BookingContext, BookingFeature } from '../extensions';
import { lazyModule } from '../../ui/lazy';
import { CustomerCell, DateCell, ModelCell, ShortDateCell, VehicleCell } from './cells';

// The cards of the drawer: one chunk, loaded with the drawer (`DetailCard.preload`).
const cards = lazyModule('core-cards', () => import('./cards'));
const TripCard = cards.component((module) => module.TripCard);
const VehicleCard = cards.component((module) => module.VehicleCard);
const CustomerCard = cards.component((module) => module.CustomerCard);
const preloadCards = cards.preload;

/** What the core feature needs from the section. */
export interface CoreFeatureDeps {
  readonly t: (key: MessageKey, params?: MessageParams) => string;
  readonly openDetail: (bookingId: string) => void;
  readonly copyId: (bookingId: string) => void;
  /** The header of a column the API sorts by, clickable. */
  readonly sortHeader: (field: string, label: string) => ReactNode;
  /** The current time, for the filters relative to now. */
  readonly now: () => Date;
}

/** Ids of the core columns hidden until the operator shows them. */
export const HIDDEN_CORE_COLUMNS: readonly string[] = ['id', 'created', 'radius', 'coordinates', 'failureReason'];

/** Whether a booking has neither an allocated nor a pre-allocated vehicle. */
export const hasNoVehicle = (ctx: BookingContext): boolean =>
  ctx.booking.vehicleId === null && !ctx.state?.value.preallocatedVehicleId;

/** A booking leaving within this many hours without a vehicle is flagged. */
export const NO_VEHICLE_SOON_HOURS = 24;

const coreColumns = (tab: ListTab, deps: CoreFeatureDeps): BookingColumn[] => {
  const { t, sortHeader } = deps;
  const upcoming = tab === 'alert' || tab === 'upcoming';
  const columns: (BookingColumn | false)[] = [
    {
      id: 'id',
      header: sortHeader('id', t('column.id')),
      width: '120px',
      render: (ctx) => <span title={ctx.booking.id}>{ctx.booking.id}</span>,
    },
    {
      id: 'start',
      header: sortHeader('startDate', t('column.start')),
      width: '150px',
      render: (ctx) => <DateCell value={ctx.booking.startDate} empty={t('common.none')} />,
    },
    {
      id: 'plannedReturn',
      header: sortHeader('plannedReturnDate', t('column.plannedReturn')),
      width: '150px',
      render: (ctx) => (
        <ShortDateCell value={ctx.booking.plannedReturnDate} empty={t('trip.noReturnDate')} />
      ),
    },
    tab === 'cancelled' && {
      id: 'cancelled',
      header: sortHeader('cancellationDate', t('column.cancelled')),
      width: '150px',
      render: (ctx) => <DateCell value={ctx.booking.cancellationDate} empty={t('common.none')} />,
    },
    {
      id: 'customer',
      header: t('column.customer'),
      width: 'minmax(180px, 1.4fr)',
      render: (ctx) => <CustomerCell ctx={ctx} />,
    },
    {
      id: 'model',
      header: t('column.model'),
      width: 'minmax(110px, 1fr)',
      render: (ctx) => <ModelCell modelId={ctx.booking.modelId} />,
    },
    {
      id: 'vehicle',
      header: t('column.vehicle'),
      width: '120px',
      render: (ctx) => <VehicleCell ctx={ctx} />,
    },
    {
      id: 'radius',
      header: sortHeader('radius', t('column.radius')),
      width: '90px',
      align: 'right',
      render: (ctx) => (ctx.booking.radius === null ? '' : t('trip.meters', { meters: ctx.booking.radius })),
    },
    {
      id: 'coordinates',
      header: t('column.coordinates'),
      width: '170px',
      render: (ctx) =>
        ctx.booking.latitude === null || ctx.booking.longitude === null
          ? ''
          : `${ctx.booking.latitude.toFixed(5)}, ${ctx.booking.longitude.toFixed(5)}`,
    },
    (upcoming || tab === 'cancelled') && {
      id: 'failureReason',
      header: t('column.failureReason'),
      width: 'minmax(140px, 1fr)',
      render: (ctx) => <span title={ctx.booking.failureReason ?? undefined}>{ctx.booking.failureReason}</span>,
    },
    {
      id: 'created',
      header: sortHeader('creationDate', t('column.created')),
      width: '150px',
      render: (ctx) => <DateCell value={ctx.booking.creationDate} empty={t('common.none')} />,
    },
  ];
  return columns
    .filter((column): column is BookingColumn => column !== false)
    .map((column) => (HIDDEN_CORE_COLUMNS.includes(column.id) ? { ...column, hiddenByDefault: true } : column));
};

/**
 * The core feature of the booking section: the columns of the bookings (dates, customer, model,
 * vehicle…), the actions to open and copy a booking, the "no vehicle" filters and KPI, and the
 * Trip, Vehicle and Customer cards of the detail.
 *
 * @param deps - Translation, navigation and sort of the section.
 * @returns The feature.
 */
export function createCoreFeature(deps: CoreFeatureDeps): BookingFeature {
  const { t } = deps;
  const soon = (ctx: BookingContext) =>
    hasNoVehicle(ctx) &&
    differenceInHours(new Date(ctx.booking.startDate), deps.now()) < NO_VEHICLE_SOON_HOURS;
  return {
    id: 'core',
    columns: (tab) => coreColumns(tab, deps),
    menuActions: (ctx) => [
      { id: 'open', label: t('action.open'), run: () => deps.openDetail(ctx.booking.id) },
      { id: 'copy-id', label: t('action.copyId'), run: () => deps.copyId(ctx.booking.id) },
    ],
    filters: [
      {
        id: 'no-vehicle',
        label: t('filter.noVehicle'),
        tabs: ['alert', 'upcoming'],
        test: hasNoVehicle,
        needsAllPages: true,
      },
      {
        id: 'no-vehicle-soon',
        label: t('filter.noVehicleSoon', { hours: NO_VEHICLE_SOON_HOURS }),
        tabs: ['alert', 'upcoming'],
        test: soon,
        needsAllPages: true,
      },
      {
        id: 'no-return-date',
        label: t('filter.noReturnDate'),
        tabs: ['alert', 'upcoming'],
        test: (ctx) => ctx.booking.plannedReturnDate === null,
        needsAllPages: true,
      },
    ],
    kpis: [
      {
        id: 'no-vehicle-soon',
        label: t('filter.noVehicleSoon', { hours: NO_VEHICLE_SOON_HOURS }),
        tab: 'upcoming',
        filterId: 'no-vehicle-soon',
        tone: 'warn',
      },
    ],
    detailCards: [
      { id: 'trip', order: 10, render: (ctx) => <TripCard ctx={ctx} />, preload: preloadCards },
      { id: 'vehicle', order: 20, render: (ctx) => <VehicleCard ctx={ctx} />, preload: preloadCards },
      { id: 'customer', order: 30, render: (ctx) => <CustomerCard ctx={ctx} />, preload: preloadCards },
    ],
  };
}
