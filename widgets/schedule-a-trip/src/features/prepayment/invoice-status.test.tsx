import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostError } from '../../test/fake-bo';
import { fakeInvoice } from '../../test/fake-aima';
import { FeatureHost } from '../../test/feature-host';
import { BOOKING_ID, booking, customer, moneySetup, NOW, renderWithBilling } from '../../test/prepayment-fixtures';
import { prepaymentFeature } from './index';
import { recordInvoiceStatus } from './invoice-status';

let setup: Awaited<ReturnType<typeof moneySetup>> | undefined;
let unmount: (() => void) | undefined;
afterEach(() => {
  setup?.disconnect();
  setup = undefined;
  unmount?.();
  unmount = undefined;
  vi.restoreAllMocks();
});

const charged = { chargeStartedAt: '2026-03-01T08:00:00.000Z', invoiceId: 'invoice-1', invoiceStatus: 'PENDING', chargeAmount: 50 };

describe('recordInvoiceStatus', () => {
  it('writes the live status and its date over the version read', async () => {
    setup = await moneySetup();
    await setup.seed(charged);

    const written = await recordInvoiceStatus(setup.deps, BOOKING_ID, { id: 'invoice-1', status: 'PAID' });

    expect(written.ok && written.value.value).toMatchObject({ invoiceStatus: 'PAID', invoiceStatusFetchedAt: NOW.toISOString() });
    expect(setup.bo.storage.api.update.mock.calls[0]?.[3]).toEqual({ ifVersion: 1 });
  });

  it('refuses another invoice, or a status already stored', async () => {
    setup = await moneySetup();
    await setup.seed(charged);

    expect(await recordInvoiceStatus(setup.deps, BOOKING_ID, { id: 'invoice-2', status: 'PAID' })).toEqual({
      ok: false,
      error: { kind: 'refused', reason: 'other-invoice' },
    });
    expect(await recordInvoiceStatus(setup.deps, BOOKING_ID, { id: 'invoice-1', status: 'PENDING' })).toEqual({
      ok: false,
      error: { kind: 'refused', reason: 'changed' },
    });
    expect(setup.bo.storage.api.update).not.toHaveBeenCalled();
  });

  it('never creates a document', async () => {
    setup = await moneySetup();

    const written = await recordInvoiceStatus(setup.deps, BOOKING_ID, { id: 'invoice-1', status: 'PAID' });

    expect(written).toEqual({ ok: false, error: { kind: 'not-found' } });
    expect(setup.stored()).toBeUndefined();
  });

  it('gives a failure of the storage', async () => {
    setup = await moneySetup();
    await setup.seed(charged);
    setup.bo.storage.api.update.mockRejectedValue(hostError('quota-exceeded', 507));

    const written = await recordInvoiceStatus(setup.deps, BOOKING_ID, { id: 'invoice-1', status: 'PAID' });

    expect(written.ok ? null : written.error.kind).toBe('quota-exceeded');
  });
});

describe('useInvoiceStatusSync', () => {
  const cell = () => document.body.querySelector('[data-column="prepayment.status"]')?.textContent ?? '';

  it('writes a status that changed into the stored state, once, and shows it', async () => {
    const rendered = await renderWithBilling(
      <FeatureHost feature={prepaymentFeature} booking={booking()} tab="upcoming" customer={customer()} />,
      { stored: charged, aima: { invoices: [fakeInvoice({ status: 'PAID' })] } },
    );
    unmount = rendered.view.unmount;

    await vi.waitFor(() => expect(rendered.stored()?.value.invoiceStatus).toBe('PAID'));
    await vi.waitFor(() => expect(cell()).toBe('Paid'));
    expect(rendered.bo.storage.api.update).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the stored status is the live one', async () => {
    const rendered = await renderWithBilling(
      <FeatureHost feature={prepaymentFeature} booking={booking()} tab="upcoming" customer={customer()} />,
      { stored: { ...charged, invoiceStatus: 'PAID' }, aima: { invoices: [fakeInvoice({ status: 'PAID' })] } },
    );
    unmount = rendered.view.unmount;

    await vi.waitFor(() => expect(cell()).toBe('Paid'));
    await vi.waitFor(() => expect(rendered.aima.calls.some((call) => call.path.endsWith('/invoices/invoice-1'))).toBe(true));
    expect(rendered.bo.storage.api.update).not.toHaveBeenCalled();
  });

  it('logs a write that failed, and keeps the live status shown', async () => {
    const rendered = await renderWithBilling(
      <FeatureHost feature={prepaymentFeature} booking={booking()} tab="upcoming" customer={customer()} />,
      { stored: charged, aima: { invoices: [fakeInvoice({ status: 'PAID' })] } },
    );
    rendered.bo.storage.api.update.mockRejectedValue(hostError('quota-exceeded', 507));
    unmount = rendered.view.unmount;

    await vi.waitFor(() =>
      expect(rendered.bo.api.log.warn).toHaveBeenCalledWith(
        'Prepayment: invoice-status ended with quota-exceeded',
        expect.objectContaining({ bookingId: BOOKING_ID }),
      ),
    );
    expect(cell()).toBe('Paid');
    expect(rendered.stored()?.value.invoiceStatus).toBe('PENDING');
  });
});
