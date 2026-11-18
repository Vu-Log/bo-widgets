import { queryOptions, useQuery } from '@tanstack/react-query';
import { useBoClient, useBoContext, useCurrentUser } from '@vulog/bo-widget-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { ListTab } from '../../domain/statuses';
import { createI18n, useI18n, type MessageKey, type MessageParams } from '../../i18n';
import { queryKeys } from '../../query/keys';
import { useWidgetSettings } from '../../settings';
import {
  bookingsCollection,
  listPendingRegularizations,
  StorageRequestError,
  type BookingStateCollection,
} from '../../storage/booking-state';
import { lazyModule } from '../../ui/lazy';
import type {
  BookingAction,
  BookingColumn,
  BookingContext,
  BookingFeature,
  BookingFilter,
  BookingKpi,
} from '../extensions';
import {
  AmountCell,
  CreditsCell,
  InternalNotesCell,
  PrepaymentStatusCell,
  RegularizationCell,
  SchedulerErrorsCell,
} from './cells';
import { PrepaymentHost } from './Host';
import { moneyBlockerReason } from './messages';
import {
  prepaymentDisplay,
  rowActions,
  schedulerErrorNames,
  unavailableActions,
  type PrepaymentActionId,
  type UnavailableReason,
} from './rules';
import { createDialogStore, prepaymentDialogs, type DialogStore } from './store';

// The cards of the drawer: one chunk, loaded with the drawer (`DetailCard.preload`).
const cards = lazyModule('prepayment-cards', () => import('./cards'));
const PaymentCard = cards.component((module) => module.PaymentCard);
const InternalNotesCard = cards.component((module) => module.InternalNotesCard);
const JournalCard = cards.component((module) => module.JournalCard);
const preloadCards = cards.preload;

/** Translates a key of the catalogues. */
export type Translate = (key: MessageKey, params?: MessageParams) => string;

/** What {@link createPrepaymentFeature} takes. */
export interface PrepaymentFeatureOptions {
  /** Translates the labels: `useI18n().t`. */
  readonly t: Translate;
  /** The current date; `new Date()` by default. */
  readonly now?: () => Date;
  /** Where the actions open their dialogs; {@link prepaymentDialogs} by default. */
  readonly dialogs?: DialogStore;
  /**
   * Why the money actions (charge, verify, retry, refund) cannot run, as a final text: invalid
   * settings, or no operator id ({@link moneyBlockerReason}). They are shown disabled with it.
   */
  readonly moneyBlocker?: string | null;
}

/** Whether each action calls the billing API: those are disabled while the settings are invalid. */
const IS_MONEY_ACTION: Readonly<Record<PrepaymentActionId, boolean>> = {
  charge: true,
  verify: true,
  retry: true,
  refund: true,
  'resume-refund': true,
  regularize: false,
  'undo-regularization': false,
  notes: false,
};

const hosts = new WeakMap<DialogStore, () => ReactNode>();

/**
 * The host of the dialogs of a store, one component per store: a new component on each new
 * feature (a change of language) would remount the dialog open and lose what was typed.
 *
 * @param store - The dialog store of the feature.
 * @returns The same component for the same store.
 */
export function prepaymentHostOf(store: DialogStore): () => ReactNode {
  let Host = hosts.get(store);
  if (!Host) {
    Host = function PrepaymentDialogs() {
      return <PrepaymentHost store={store} />;
    };
    hosts.set(store, Host);
  }
  return Host;
}

const UNAVAILABLE_REASONS: Readonly<Record<UnavailableReason, MessageKey>> = {
  archived: 'prepayment.tooltip.archived',
  'no-data': 'prepayment.status.noneFromWidget',
};

const ACTION_LABELS: Readonly<Record<PrepaymentActionId, MessageKey>> = {
  charge: 'prepayment.action.charge',
  verify: 'prepayment.action.verify',
  retry: 'prepayment.action.retry',
  refund: 'prepayment.action.refund',
  'resume-refund': 'prepayment.action.resumeRefund',
  regularize: 'prepayment.action.regularize',
  'undo-regularization': 'prepayment.action.undoRegularization',
  notes: 'prepayment.action.notes',
};

const ACTION_TONES: Readonly<Record<PrepaymentActionId, BookingAction['tone']>> = {
  charge: 'primary',
  verify: 'default',
  retry: 'primary',
  refund: 'danger',
  'resume-refund': 'danger',
  regularize: 'primary',
  'undo-regularization': 'default',
  notes: 'default',
};

const UPCOMING: ListTab[] = ['upcoming', 'alert'];
const FAILED_STATUSES = new Set(['REFUSED', 'ERROR', 'MOP_MISSING']);

/** Ids of the filters of the feature. */
export const PREPAYMENT_FILTER_IDS = {
  toPrepay: 'prepayment.to-prepay',
  paymentFailed: 'prepayment.payment-failed',
  toRefund: 'prepayment.to-refund',
  toRegularize: 'prepayment.to-regularize',
  schedulerErrors: 'prepayment.scheduler-errors',
} as const;

/**
 * The prepayment feature: its columns, actions, filters, KPIs, detail cards and
 * dialogs, plugged into the booking list and its drawer.
 *
 * - The labels are translated with `options.t`: build it per language ({@link usePrepaymentFeature}).
 * - Filters and KPIs read the document of each row, and the invoice status cached in it: a
 *   payment that failed after the last action of the widget is only seen once its row is shown.
 * - "To regularize" is served by the storage without reading the AIMA pages:
 *   {@link pendingRegularizationsQueryOptions} gives the bookings to list.
 *
 * @param options - Translation, clock and dialog store.
 * @returns The feature.
 */
export function createPrepaymentFeature(options: PrepaymentFeatureOptions): BookingFeature {
  const { t } = options;
  const now = options.now ?? (() => new Date());
  const dialogs = options.dialogs ?? prepaymentDialogs;
  const moneyBlocker = options.moneyBlocker ?? null;
  const Host = prepaymentHostOf(dialogs);

  /** An action; `reason` disables it, and so does {@link moneyBlocker} for a money action. */
  const action = (id: PrepaymentActionId, reason: string | null = null): BookingAction => {
    const disabledReason = reason ?? (IS_MONEY_ACTION[id] ? moneyBlocker : null);
    return {
      id: `prepayment.${id}`,
      label: t(ACTION_LABELS[id]),
      tone: ACTION_TONES[id],
      ...(disabledReason ? { disabled: true, disabledReason } : {}),
      run: (ctx) => dialogs.open({ action: id, ctx }),
    };
  };

  const column = (
    id: string,
    header: MessageKey,
    width: string,
    render: (ctx: BookingContext) => React.ReactNode,
    options: { readonly align?: 'right'; readonly hiddenByDefault?: boolean } = {},
  ): BookingColumn => ({
    id: `prepayment.${id}`,
    header: t(header),
    width,
    render,
    ...options,
  });

  const amount = column('amount', 'prepayment.column.amount', '100px', (ctx) => <AmountCell ctx={ctx} />, { align: 'right' });
  const status = column('status', 'prepayment.column.status', '180px', (ctx) => <PrepaymentStatusCell ctx={ctx} />);
  const credits = column('credits', 'prepayment.column.credits', '180px', (ctx) => <CreditsCell ctx={ctx} />);
  // Wide, and for some operators only: shown from the Columns menu.
  const notes = column('notes', 'prepayment.column.notes', 'minmax(120px, 1fr)', (ctx) => <InternalNotesCell ctx={ctx} />, {
    hiddenByDefault: true,
  });
  const errors = column('scheduler-errors', 'prepayment.column.schedulerErrors', '180px', (ctx) => (
    <SchedulerErrorsCell ctx={ctx} />
  ));
  const regularization = column('regularization', 'prepayment.column.regularization', '190px', (ctx) => (
    <RegularizationCell ctx={ctx} />
  ));

  const filters: BookingFilter[] = [
    {
      id: PREPAYMENT_FILTER_IDS.toPrepay,
      label: t('prepayment.filter.toPrepay'),
      tabs: UPCOMING,
      needsAllPages: true,
      test: (ctx) => prepaymentDisplay(ctx, null, now()) === 'NOT_CHARGED',
    },
    {
      id: PREPAYMENT_FILTER_IDS.paymentFailed,
      label: t('prepayment.filter.paymentFailed'),
      tabs: UPCOMING,
      needsAllPages: true,
      test: (ctx) => FAILED_STATUSES.has(ctx.state?.value.invoiceStatus ?? ''),
    },
    {
      id: PREPAYMENT_FILTER_IDS.toRefund,
      label: t('prepayment.filter.toRefund'),
      tabs: ['cancelled'],
      needsAllPages: true,
      test: (ctx) => {
        const primary = rowActions(ctx, now()).primary;
        return primary === 'refund' || primary === 'resume-refund';
      },
    },
    {
      id: PREPAYMENT_FILTER_IDS.toRegularize,
      label: t('prepayment.filter.toRegularize'),
      tabs: ['cancelled'],
      // Served by the storage query: see pendingRegularizationsQueryOptions.
      needsAllPages: false,
      test: (ctx) => ctx.state?.value.regularizationPending === true,
    },
    {
      id: PREPAYMENT_FILTER_IDS.schedulerErrors,
      label: t('prepayment.filter.schedulerErrors'),
      tabs: UPCOMING,
      needsAllPages: true,
      test: (ctx) => schedulerErrorNames(ctx.state?.value).length > 0,
    },
  ];

  const kpis: BookingKpi[] = [
    { id: 'prepayment.kpi.to-prepay', label: t('prepayment.filter.toPrepay'), tab: 'upcoming', filterId: PREPAYMENT_FILTER_IDS.toPrepay, tone: 'warn' },
    { id: 'prepayment.kpi.payment-failed', label: t('prepayment.filter.paymentFailed'), tab: 'upcoming', filterId: PREPAYMENT_FILTER_IDS.paymentFailed, tone: 'err' },
    { id: 'prepayment.kpi.to-regularize', label: t('prepayment.filter.toRegularize'), tab: 'cancelled', filterId: PREPAYMENT_FILTER_IDS.toRegularize, tone: 'warn' },
    { id: 'prepayment.kpi.scheduler-errors', label: t('prepayment.filter.schedulerErrors'), tab: 'upcoming', filterId: PREPAYMENT_FILTER_IDS.schedulerErrors, tone: 'err' },
  ];

  return {
    id: 'prepayment',
    columns: (tab) => {
      switch (tab) {
        case 'upcoming':
        case 'alert':
          return [amount, status, credits, notes, errors];
        case 'ongoing':
        case 'completed':
          return [amount, status, credits];
        case 'cancelled':
          return [status, credits, regularization];
      }
    },
    primaryAction: (ctx) => {
      const actions = rowActions(ctx, now());
      if (!actions.primary) return null;
      return action(actions.primary, actions.primaryDisabled ? t('common.loading') : null);
    },
    menuActions: (ctx) => {
      const at = now();
      return [
        ...rowActions(ctx, at).menu.map((id) => action(id)),
        ...unavailableActions(ctx, at).map(({ id, reason }) => action(id, t(UNAVAILABLE_REASONS[reason]))),
      ];
    },
    filters,
    kpis,
    // After the cards of the booking section (Actions 5, Trip 10, Vehicle 20, Customer 30).
    detailCards: [
      {
        id: 'prepayment.payment',
        order: 40,
        render: (ctx) => <PaymentCard ctx={ctx} dialogs={dialogs} />,
        preload: preloadCards,
      },
      {
        id: 'prepayment.notes',
        order: 50,
        render: (ctx) => <InternalNotesCard ctx={ctx} dialogs={dialogs} />,
        preload: preloadCards,
      },
      { id: 'prepayment.journal', order: 90, render: (ctx) => <JournalCard ctx={ctx} />, preload: preloadCards },
    ],
    Host,
  };
}

/** The prepayment feature with English labels. Use {@link usePrepaymentFeature} in the widget. */
export const prepaymentFeature: BookingFeature = createPrepaymentFeature({ t: createI18n(null).t });

/**
 * The prepayment feature in the language of the back office, built again when it or the settings
 * change: its money actions are disabled, with the reason, while the settings are invalid. Its
 * dialogs have a store of their own, and a host that keeps its identity.
 *
 * @param options - The clock of the section; `new Date()` by default.
 * @returns The feature.
 */
export function usePrepaymentFeature(options: { readonly now?: () => Date } = {}): BookingFeature {
  const { now } = options;
  // `t` changes with the locale of the back office only.
  const { t } = useI18n();
  const settings = useWidgetSettings();
  const user = useCurrentUser();
  const moneyBlocker = moneyBlockerReason(settings.isError ? null : settings.data, user.id, t);
  const [dialogs] = useState(createDialogStore);
  return useMemo(
    () => createPrepaymentFeature({ t, now, dialogs, moneyBlocker }),
    [t, now, dialogs, moneyBlocker],
  );
}

/**
 * The bookings of the fleet with a regularization to do, read from the storage
 * (`{ fleetId, regularizationPending: true }`), for the "To regularize" filter and KPI: the list
 * reads these bookings instead of every page of the Cancelled tab. In memory only.
 *
 * @param collection - `bookingsCollection(bo.storage)`.
 * @param fleetId - The fleet.
 * @returns Options for `useQuery`, resolving the documents.
 */
export const pendingRegularizationsQueryOptions = (
  collection: BookingStateCollection,
  fleetId: string,
) =>
  queryOptions({
    queryKey: queryKeys.pendingRegularizations(fleetId),
    queryFn: async () => {
      const result = await listPendingRegularizations(collection, fleetId);
      if (!result.ok) throw new StorageRequestError(result.error);
      return result.value;
    },
    staleTime: 30_000,
  });

/**
 * The pending regularizations of the current fleet ({@link pendingRegularizationsQueryOptions}).
 *
 * @returns The query.
 */
export function usePendingRegularizations() {
  const bo = useBoClient();
  const { fleetId } = useBoContext();
  const collection = useMemo(() => bookingsCollection(bo.storage), [bo]);
  return useQuery({
    ...pendingRegularizationsQueryOptions(collection, fleetId ?? ''),
    enabled: Boolean(fleetId),
  });
}

