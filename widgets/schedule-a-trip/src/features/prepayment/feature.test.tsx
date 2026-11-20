import { QueryClient } from '@tanstack/react-query';
import { connect } from '@vulog/bo-widget-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyText } from '../../test/dom';
import { fakeBo, hostError, VALID_SETTINGS } from '../../test/fake-bo';
import { customer, doc, NOW, renderWithBilling, row } from '../../test/prepayment-fixtures';
import { createI18n } from '../../i18n';
import { bookingsCollection, BOOKINGS_COLLECTION, StorageRequestError } from '../../storage/booking-state';
import { useBoContext } from '@vulog/bo-widget-react';
import {
  createPrepaymentFeature,
  pendingRegularizationsQueryOptions,
  PREPAYMENT_FILTER_IDS,
  prepaymentFeature,
  usePendingRegularizations,
  usePrepaymentFeature,
} from './index';
import { createDialogStore } from './store';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

const t = createI18n('en_GB').t;
const filter = (id: string) => prepaymentFeature.filters?.find((candidate) => candidate.id === id);

describe('createPrepaymentFeature', () => {
  it('adds the columns of each tab', () => {
    const ids = (tab: Parameters<NonNullable<typeof prepaymentFeature.columns>>[0]) =>
      prepaymentFeature.columns?.(tab).map((column) => column.id);
    expect(ids('upcoming')).toEqual(['prepayment.amount', 'prepayment.status', 'prepayment.credits', 'prepayment.notes', 'prepayment.scheduler-errors']);
    expect(ids('alert')).toEqual(ids('upcoming'));
    expect(ids('ongoing')).toEqual(['prepayment.amount', 'prepayment.status', 'prepayment.credits']);
    expect(ids('completed')).toEqual(ids('ongoing'));
    expect(ids('cancelled')).toEqual(['prepayment.status', 'prepayment.credits', 'prepayment.regularization']);
    expect(prepaymentFeature.columns?.('upcoming')[0]).toMatchObject({ header: 'Amount', align: 'right' });
    // The internal notes are shown from the Columns menu only.
    const hidden = prepaymentFeature.columns?.('upcoming').filter((column) => column.hiddenByDefault);
    expect(hidden?.map((column) => column.id)).toEqual(['prepayment.notes']);
  });

  it('gives the primary action and the menu, which open their dialog', () => {
    const dialogs = createDialogStore();
    const feature = createPrepaymentFeature({ t, dialogs, now: () => NOW });
    const ctx = row();
    const primary = feature.primaryAction?.(ctx);
    expect(primary).toMatchObject({ id: 'prepayment.charge', label: 'Prepay', tone: 'primary' });
    expect(primary?.disabled).toBeUndefined();
    primary?.run(ctx);
    expect(dialogs.getSnapshot()).toEqual({ action: 'charge', ctx });
    expect(feature.menuActions?.(ctx).map((action) => action.label)).toEqual(['Internal notes']);
    expect(feature.primaryAction?.(row({ customer: undefined }))).toMatchObject({ disabled: true, disabledReason: 'Loading…' });
    expect(feature.primaryAction?.(row({ state: undefined }))).toBeNull();
  });

  it('disables the money actions with the reason it is given, never the others', () => {
    const feature = createPrepaymentFeature({ t, now: () => NOW, moneyBlocker: 'Settings to fix' });
    expect(feature.primaryAction?.(row())).toMatchObject({ id: 'prepayment.charge', disabled: true, disabledReason: 'Settings to fix' });
    const cancelled = row({
      tab: 'cancelled',
      state: doc({ chargeStartedAt: NOW.toISOString(), invoiceId: 'i-1', invoiceStatus: 'PAID', regularizedAt: NOW.toISOString() }),
    });
    expect(feature.primaryAction?.(cancelled)).toMatchObject({ id: 'prepayment.refund', disabledReason: 'Settings to fix' });
    for (const action of feature.menuActions?.(cancelled) ?? []) {
      expect(action.id).toMatch(/notes|undo-regularization/);
      expect(action.disabled).toBeUndefined();
    }
  });

  it('disables exactly the actions that call the billing API', () => {
    const feature = createPrepaymentFeature({ t, now: () => NOW, moneyBlocker: 'X' });
    const charged = { chargeStartedAt: NOW.toISOString(), invoiceId: 'i-1' };
    const primary = (ctx: ReturnType<typeof row>) => {
      const action = feature.primaryAction?.(ctx);
      return [action?.id, action?.disabledReason ?? null];
    };
    expect(primary(row({ state: doc({ chargeStartedAt: NOW.toISOString() }) }))).toEqual(['prepayment.verify', 'X']);
    expect(primary(row({ state: doc({ ...charged, invoiceStatus: 'REFUSED' }) }))).toEqual(['prepayment.retry', 'X']);
    expect(primary(row({ tab: 'cancelled', state: doc({ ...charged, invoiceStatus: 'PAID', refundedAt: NOW.toISOString() }) }))).toEqual([
      'prepayment.resume-refund',
      'X',
    ]);
    expect(
      primary(row({ tab: 'cancelled', state: doc({ ...charged, invoiceStatus: 'REFUNDED', refundedAt: NOW.toISOString(), toRegularize: { missingAmount: 1, at: NOW.toISOString() }, regularizationPending: true }) })),
    ).toEqual(['prepayment.regularize', null]);
  });

  it('opens the dialogs of its cards in its own store, shown by its host', async () => {
    const dialogs = createDialogStore();
    const feature = createPrepaymentFeature({ t, now: () => NOW, dialogs });
    expect(createPrepaymentFeature({ t, dialogs }).Host).toBe(feature.Host);
    const Host = feature.Host!;
    const ctx = row({ state: doc({ internalNotes: '' }) });
    const rendered = await renderWithBilling(
      <>
        {feature.detailCards?.map((card) => <div key={card.id}>{card.render(ctx)}</div>)}
        <Host />
      </>,
    );
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(bodyText()).toContain('Internal notes'));
    [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent === 'Internal notes')?.click();
    await vi.waitFor(() => expect(dialogs.getSnapshot()).toMatchObject({ action: 'notes' }));
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).not.toBeNull());
  });

  it('shows the refund and the notes disabled without stored data, with why', () => {
    const feature = createPrepaymentFeature({ t, now: () => NOW });
    const reasons = (ctx: ReturnType<typeof row>) =>
      (feature.menuActions?.(ctx) ?? []).map((action) => [action.label, action.disabledReason ?? null]);
    expect(reasons(row({ tab: 'cancelled', state: null }))).toEqual([
      ['Internal notes', null],
      ['Refund', 'No prepayment from the widget'],
    ]);
    const old = { startDate: '2024-01-01T08:00:00.000Z', endDate: null, plannedReturnDate: null, cancellationDate: '2024-01-01T07:00:00.000Z' };
    const archived = 'Prepayment, notes and journal are not kept beyond 365 days.';
    expect(reasons(row({ tab: 'cancelled', state: null, booking: { ...row().booking, ...old } }))).toEqual([
      ['Refund', archived],
      ['Internal notes', archived],
    ]);
    expect(reasons(row({ tab: 'completed', state: null, booking: { ...row().booking, ...old } }))).toEqual([['Internal notes', archived]]);
    expect(feature.primaryAction?.(row({ tab: 'cancelled', state: null }))).toBeNull();
  });

  it('filters the rows to prepay, failed, to refund, to regularize and with scheduler errors', () => {
    const charged = { chargeStartedAt: NOW.toISOString(), invoiceId: 'i-1' };
    const toPrepay = filter(PREPAYMENT_FILTER_IDS.toPrepay);
    expect(toPrepay?.test(row())).toBe(true);
    expect(toPrepay?.test(row({ customer: customer('Business') }))).toBe(false);
    expect(toPrepay?.test(row({ state: doc(charged) }))).toBe(false);
    expect(toPrepay?.needsAllPages).toBe(true);

    const failed = filter(PREPAYMENT_FILTER_IDS.paymentFailed);
    expect(failed?.test(row({ state: doc({ ...charged, invoiceStatus: 'REFUSED' }) }))).toBe(true);
    expect(failed?.test(row({ state: doc({ ...charged, invoiceStatus: 'PAID' }) }))).toBe(false);

    const toRefund = filter(PREPAYMENT_FILTER_IDS.toRefund);
    expect(toRefund?.test(row({ tab: 'cancelled', state: doc({ ...charged, invoiceStatus: 'PAID' }) }))).toBe(true);
    expect(toRefund?.test(row({ tab: 'cancelled', state: null }))).toBe(false);

    const toRegularize = filter(PREPAYMENT_FILTER_IDS.toRegularize);
    expect(toRegularize).toMatchObject({ tabs: ['cancelled'], needsAllPages: false });
    expect(toRegularize?.test(row({ state: doc({ toRegularize: { missingAmount: 1, at: NOW.toISOString() }, regularizationPending: true }) }))).toBe(true);
    expect(toRegularize?.test(row({ state: null }))).toBe(false);

    const errors = filter(PREPAYMENT_FILTER_IDS.schedulerErrors);
    expect(errors?.test(row({ state: doc({ schedulerErrors: { allocationFailed: NOW.toISOString() } }) }))).toBe(true);
    expect(errors?.test(row({ state: doc() }))).toBe(false);
  });

  it('points each KPI to a filter of the feature', () => {
    const filterIds = new Set(prepaymentFeature.filters?.map((candidate) => candidate.id));
    expect(prepaymentFeature.kpis?.map((kpi) => [kpi.label, kpi.tab, kpi.tone])).toEqual([
      ['To prepay', 'upcoming', 'warn'],
      ['Payment failed', 'upcoming', 'err'],
      ['To regularize', 'cancelled', 'warn'],
      ['Scheduler errors', 'upcoming', 'err'],
    ]);
    for (const kpi of prepaymentFeature.kpis ?? []) expect(filterIds.has(kpi.filterId)).toBe(true);
  });

  it('orders its detail cards and renders them', async () => {
    expect(prepaymentFeature.detailCards?.map((card) => [card.id, card.order])).toEqual([
      ['prepayment.payment', 40],
      ['prepayment.notes', 50],
      ['prepayment.journal', 90],
    ]);
    const rendered = await renderWithBilling(<>{prepaymentFeature.detailCards?.map((card) => <div key={card.id}>{card.render(row({ state: null }))}</div>)}</>);
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(bodyText()).toContain('Payment'));
    expect(bodyText()).toContain('Journal');
  });
});

describe('usePrepaymentFeature', () => {
  function Labels() {
    const feature = usePrepaymentFeature();
    return <span>{feature.kpis?.map((kpi) => kpi.label).join('|')}</span>;
  }

  function Reason() {
    const feature = usePrepaymentFeature({ now: () => NOW });
    return <span>{feature.primaryAction?.(row())?.disabledReason ?? 'none'}</span>;
  }

  it('disables the money actions with the settings to fix and their problem', async () => {
    const rendered = await renderWithBilling(<Reason />, {
      bo: { getSettings: async () => ({ ...VALID_SETTINGS, dayRate: -1, prepaymentProductId: undefined }) },
    });
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(bodyText()).toContain('settings of the widget are incomplete'));
    expect(bodyText()).toContain('prepaymentProductId (missing)');
    expect(bodyText()).toContain('dayRate (invalid value)');
  });

  it('enables them with valid settings', async () => {
    const rendered = await renderWithBilling(<Reason />);
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(bodyText()).toBe('none'));
  });

  it('keeps the host of its dialogs while the language changes', async () => {
    const hosts = new Set<unknown>();
    function Hosts() {
      const feature = usePrepaymentFeature();
      hosts.add(feature.Host);
      return null;
    }
    const rendered = await renderWithBilling(<Hosts />);
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(hosts.size).toBeGreaterThan(0));
    rendered.bo.emit('localeChanged', { locale: 'fr_FR' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(hosts.size).toBe(1);
  });

  it('speaks the language of the back office', async () => {
    const rendered = await renderWithBilling(<Labels />, {
      bo: { getContext: async () => ({ fleetId: 'FLEET-1', locale: 'fr_FR', basename: '/' }) },
    });
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(bodyText()).toContain(createI18n('fr_FR').t('prepayment.filter.toPrepay')));
    expect(bodyText()).not.toContain('To prepay');
  });
});

describe('pendingRegularizationsQueryOptions', () => {
  it('reads the pending regularizations of the fleet from the storage', async () => {
    const bo = fakeBo();
    const client = await connect({ vulogBo: bo.api });
    await bo.storage.api.set(BOOKINGS_COLLECTION, 'booking-1', {
      schemaVersion: 1,
      fleetId: 'FLEET-1',
      allocationProcessed: false,
      toRegularize: { missingAmount: 2, at: NOW.toISOString() },
      regularizationPending: true,
    });
    const queryClient = new QueryClient();

    const result = await queryClient.fetchQuery(pendingRegularizationsQueryOptions(bookingsCollection(client.storage), 'FLEET-1'));

    expect(result.docs.map((item) => item.id)).toEqual(['booking-1']);
    client.disconnect();
  });

  it('throws a storage failure', async () => {
    const bo = fakeBo();
    const client = await connect({ vulogBo: bo.api });
    bo.storage.api.query.mockRejectedValueOnce(hostError('rate-limited', 429));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await expect(queryClient.fetchQuery(pendingRegularizationsQueryOptions(bookingsCollection(client.storage), 'FLEET-1'))).rejects.toBeInstanceOf(StorageRequestError);
    client.disconnect();
  });

  it('is served by a hook for the current fleet', async () => {
    function Count() {
      const { fleetId } = useBoContext();
      const query = usePendingRegularizations();
      return <span>{`${fleetId}:${query.data?.docs.length ?? 'loading'}`}</span>;
    }
    const rendered = await renderWithBilling(<Count />, { stored: { toRegularize: { missingAmount: 2, at: NOW.toISOString() }, regularizationPending: true } });
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(bodyText()).toBe('FLEET-1:1'));
  });
});
