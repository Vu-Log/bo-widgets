import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyText, button, click, field, typeInto } from '../../../test/dom';
import { fakeAima } from '../../../test/fake-aima';
import { fakeBo, VALID_SETTINGS } from '../../../test/fake-bo';
import { booking, customer, row } from '../../../test/prepayment-fixtures';
import { renderInWidget } from '../../../test/render';
import { BOOKINGS_COLLECTION } from '../../../storage/booking-state';
import type { BookingContext } from '../../extensions';
import { ChargeDialog, parseAmount } from './ChargeDialog';

let view: Awaited<ReturnType<typeof renderInWidget>> | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
  vi.restoreAllMocks();
});

const open = async (ctx: BookingContext = row(), overrides: Record<string, unknown> = {}) => {
  const bo = fakeBo({ getSettings: async () => ({ ...VALID_SETTINGS, currency: 'EUR' }), ...overrides });
  const aima = fakeAima();
  aima.stubFetch();
  const onClose = vi.fn();
  view = await renderInWidget(<ChargeDialog ctx={ctx} onClose={onClose} />, bo.api);
  return { bo, aima, onClose };
};

describe('parseAmount', () => {
  it('reads a comma or a point, and nothing as NaN', () => {
    expect(parseAmount('12,5')).toBe(12.5);
    expect(parseAmount(' 7 ')).toBe(7);
    expect(parseAmount('')).toBeNaN();
    expect(parseAmount('abc')).toBeNaN();
  });
});

describe('ChargeDialog', () => {
  it('prefills the computed amount, confirms, then charges', async () => {
    const { bo, aima } = await open();

    await vi.waitFor(() => expect((field() as HTMLInputElement).value).toBe('50'));
    expect(bodyText()).toContain('Computed amount: €50.00 (12 h)');
    click('Prepay');
    await vi.waitFor(() => expect(bodyText()).toContain('The customer will be charged €50.00. Confirm?'));
    click('Charge €50.00');

    await vi.waitFor(() => expect(bodyText()).toContain('The prepayment is charged.'));
    expect(aima.callsTo('POST', '/invoices/product')).toHaveLength(1);
    expect(bo.storage.docs(BOOKINGS_COLLECTION).get('booking-1')?.value).toMatchObject({ invoiceId: 'invoice-new-1', chargeAmount: 50 });
  });

  it('warns above the computed amount and asks to prepay anyway', async () => {
    await open();
    await vi.waitFor(() => expect((field() as HTMLInputElement).value).toBe('50'));

    typeInto(field(), '60');

    await vi.waitFor(() => expect(bodyText()).toContain('Exceeds the computed amount (€50.00, ratio 1) by €10.00.'));
    expect(button('Prepay anyway')).toBeDefined();
  });

  it('gives no warning below the computed amount above the minimum', async () => {
    await open();
    await vi.waitFor(() => expect((field() as HTMLInputElement).value).toBe('50'));
    typeInto(field(), '20');
    await vi.waitFor(() => expect(bodyText()).toContain('≈ 4 h'));
    expect(bodyText()).not.toContain('Below the minimum');
    expect(button('Prepay')?.disabled).toBe(false);
  });

  it('requires the amount without a return date, with its duration estimated as typed', async () => {
    await open(row({ booking: booking({ plannedReturnDate: null }) }));
    await vi.waitFor(() => expect(bodyText()).toContain('No planned return date'));
    expect(button('Prepay')?.disabled).toBe(true);

    typeInto(field(), '5');

    await vi.waitFor(() => expect(bodyText()).toContain('Below the minimum of €10.00.'));
    expect(bodyText()).toContain('≈ 1 h');
    typeInto(field(), '120');
    await vi.waitFor(() => expect(bodyText()).toContain('≈ 1 d 4 h'));
  });

  it('refuses 0 and text', async () => {
    await open();
    await vi.waitFor(() => expect((field() as HTMLInputElement).value).toBe('50'));
    typeInto(field(), '0');
    await vi.waitFor(() => expect(bodyText()).toContain('Type an amount greater than 0.'));
    expect(button('Prepay')?.disabled).toBe(true);
  });

  it('refuses a business booking', async () => {
    await open(row({ customer: customer('Business') }));
    await vi.waitFor(() => expect(bodyText()).toContain('No prepayment for a business profile.'));
    expect(button('Prepay')?.disabled).toBe(true);
  });

  it('disables the charge with the reason when the settings are invalid', async () => {
    await open(row(), { getSettings: async () => ({ ...VALID_SETTINGS, ratio: 0 }) });
    await vi.waitFor(() => expect(bodyText()).toContain('the settings of the widget are incomplete (ratio)'));
    expect(button('Prepay')?.disabled).toBe(true);
  });

  it('names the action on a 403 and releases the claim', async () => {
    const { aima, bo } = await open();
    aima.failNext('charge', { status: 403 });
    await vi.waitFor(() => expect((field() as HTMLInputElement).value).toBe('50'));
    click('Prepay');
    await vi.waitFor(() => expect(button('Charge €50.00')).toBeDefined());
    click('Charge €50.00');

    await vi.waitFor(() => expect(bodyText()).toContain('You are not allowed to charge a prepayment'));
    expect(bo.storage.docs(BOOKINGS_COLLECTION).get('booking-1')?.value.chargeStartedAt).toBeNull();
  });

  it('says to verify when the answer is lost', async () => {
    const { aima } = await open();
    aima.loseNextChargeAnswer();
    await vi.waitFor(() => expect((field() as HTMLInputElement).value).toBe('50'));
    click('Prepay');
    await vi.waitFor(() => expect(button('Charge €50.00')).toBeDefined());
    click('Charge €50.00');
    await vi.waitFor(() => expect(bodyText()).toContain('The answer of the Vulog API was lost'));
  });

  it('closes', async () => {
    const { onClose } = await open();
    await vi.waitFor(() => expect(button('Close')).toBeDefined());
    click('Close');
    expect(onClose).toHaveBeenCalled();
  });
});
