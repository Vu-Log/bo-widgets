import { afterEach, describe, expect, it } from 'vitest';
import { fakeInvoice } from '../../test/fake-aima';
import { BOOKING_ID, booking, moneySetup, settings } from '../../test/prepayment-fixtures';
import type { BookingState } from '../../storage/booking-state';
import { readBookingState } from '../../storage/booking-state';
import { executeRefund, planRefund, type RefundPlan } from './refund';

let setup: Awaited<ReturnType<typeof moneySetup>>;
afterEach(() => setup?.disconnect());

const START = '2026-03-12T08:00:00.000Z';
/** A cancellation `hours` before the start. */
const cancelledBefore = (hours: number) =>
  booking({ status: 'CANCELLED', startDate: START, cancellationDate: new Date(Date.parse(START) - hours * 3_600_000).toISOString() });

const prepaid: Partial<BookingState> = {
  chargeStartedAt: '2026-03-01T08:00:00.000Z',
  chargeStartedBy: 'operator-1',
  invoiceId: 'invoice-1',
  chargeAmount: 50,
  entityId: 'entity-1',
  creditsAdded: true,
  walletId: 'wallet-1',
};

const refundSettings = () => {
  const { refundFullHours, creditsRevokeHours, cancellationFeesProductId } = settings();
  return { refundFullHours, creditsRevokeHours, cancellationFeesProductId };
};

const start = async (
  options: { hours?: number; state?: Partial<BookingState>; balance?: number; price?: number } = {},
) => {
  setup = await moneySetup({
    invoices: [fakeInvoice()],
    wallets: [{ id: 'wallet-1', availableAmount: options.balance ?? 40 }],
    productPrice: options.price ?? 15,
  });
  await setup.seed({ ...prepaid, ...options.state });
};

const plan = async (hours: number): Promise<RefundPlan> => {
  const read = await readBookingState(setup.collection, BOOKING_ID);
  if (!read.ok) throw new Error('unreadable');
  const planned = await planRefund(setup.deps, { booking: cancelledBefore(hours), doc: read.value, settings: refundSettings() });
  if (!planned.ok) throw new Error(`no plan: ${planned.error.kind}`);
  return planned.plan;
};

const eventTypes = () => (setup.stored()?.value.events as { type: string }[]).map((event) => event.type);
const feeCharges = () =>
  setup.aima.callsTo('POST', '/invoices/product').filter((call) => (call.body as { productId: string }).productId === refundSettings().cancellationFeesProductId);

describe('planRefund', () => {
  it('reads the refundable amount, the policy, the fees and the wallet without writing', async () => {
    await start({ balance: 5 });

    const planned = await plan(0.5);

    expect(planned).toMatchObject({
      refund: { amount: 50, pspReference: 'psp-1' },
      policy: { kind: 'refund-with-fee-and-credits-revocation', hoursBeforeStart: 0.5 },
      fee: { amount: 15, userId: 'customer-1', entityId: 'entity-1' },
      credits: { kind: 'revoke', walletId: 'wallet-1', balance: 5 },
      missingAmount: 10,
      feeInDoubt: false,
    });
    expect(setup.bo.storage.api.update).not.toHaveBeenCalled();
    expect(setup.aima.calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('plans a full refund without fees nor wallet calls when cancelled early', async () => {
    await start();
    const planned = await plan(48);
    expect(planned).toMatchObject({ fee: null, credits: { kind: 'none' }, missingAmount: 0 });
    expect(setup.aima.calls.map((call) => call.path.split('/').at(-1))).toEqual(['invoice-1', 'refundableAmount']);
  });

  it.each([
    ['no document', null, 'no-document'],
    ['no invoice', { invoiceId: null }, 'no-invoice'],
    ['a business booking', { isB2B: true }, 'b2b'],
  ])('refuses %s', async (_, state, kind) => {
    await start();
    const doc = state === null ? null : { id: BOOKING_ID, version: 1, expiresAt: null, value: { schemaVersion: 1 as const, fleetId: 'FLEET-1', allocationProcessed: false, ...prepaid, ...state } };
    const planned = await planRefund(setup.deps, { booking: cancelledBefore(48), doc, settings: refundSettings() });
    expect(planned).toEqual({ ok: false, error: { kind } });
  });

  it('refuses without a cancellation date', async () => {
    await start();
    const read = await readBookingState(setup.collection, BOOKING_ID);
    const planned = await planRefund(setup.deps, {
      booking: booking({ cancellationDate: null }),
      doc: read.ok ? read.value : null,
      settings: refundSettings(),
    });
    expect(planned).toEqual({ ok: false, error: { kind: 'no-cancellation-date' } });
  });

  it('refuses an invoice that is not paid, without asking for the refundable amount', async () => {
    await start();
    const invoice = setup.aima.invoices.get('invoice-1');
    if (invoice) invoice.status = 'PENDING';
    const read = await readBookingState(setup.collection, BOOKING_ID);
    const planned = await planRefund(setup.deps, { booking: cancelledBefore(48), doc: read.ok ? read.value : null, settings: refundSettings() });
    expect(planned).toEqual({ ok: false, error: { kind: 'invoice-not-paid', status: 'PENDING' } });
    expect(setup.aima.callsTo('GET', '/refundableAmount')).toEqual([]);
  });

  it('refuses when nothing is left to refund, even with no receipt', async () => {
    await start();
    const invoice = setup.aima.invoices.get('invoice-1');
    if (invoice) invoice.refundable = 0;
    const read = await readBookingState(setup.collection, BOOKING_ID);
    const planned = await planRefund(setup.deps, { booking: cancelledBefore(48), doc: read.ok ? read.value : null, settings: refundSettings() });
    expect(planned).toEqual({ ok: false, error: { kind: 'nothing-to-refund' } });
  });

  it('gives the API failure (a 403 included)', async () => {
    await start();
    setup.aima.failNext('refundable', { status: 403 });
    const read = await readBookingState(setup.collection, BOOKING_ID);
    const planned = await planRefund(setup.deps, { booking: cancelledBefore(48), doc: read.ok ? read.value : null, settings: refundSettings() });
    expect(planned).toEqual({ ok: false, error: { kind: 'api', error: { kind: 'not-allowed', status: 403 } } });
  });

  it('refuses when the wallet recorded by the scheduler is gone', async () => {
    await start({ state: { walletId: 'wallet-gone' } });
    const read = await readBookingState(setup.collection, BOOKING_ID);
    const planned = await planRefund(setup.deps, { booking: cancelledBefore(0.5), doc: read.ok ? read.value : null, settings: refundSettings() });
    expect(planned).toEqual({ ok: false, error: { kind: 'wallet-not-found' } });
  });

  it('refuses the fees without the entity billed', async () => {
    await start({ state: { entityId: undefined } });
    const read = await readBookingState(setup.collection, BOOKING_ID);
    const planned = await planRefund(setup.deps, { booking: cancelledBefore(10), doc: read.ok ? read.value : null, settings: refundSettings() });
    expect(planned).toEqual({ ok: false, error: { kind: 'missing-billing' } });
  });
});

describe('executeRefund', () => {
  it('refunds in full and starts the expiry', async () => {
    await start();

    const outcome = await executeRefund(setup.deps, await plan(48));

    expect(outcome).toMatchObject({ kind: 'done', missingAmount: 0, feeAmount: 0 });
    expect(setup.aima.callsTo('POST', '/refund')[0]?.body).toEqual({
      amount: 50,
      note: 'Schedule a trip booking-1 – refund of the prepayment',
      paymentIntentPspReference: 'psp-1',
    });
    expect(feeCharges()).toEqual([]);
    expect(setup.stored()?.value.refundedAt).toBeTruthy();
    expect(setup.stored()?.expiresAt).toBeTruthy();
    expect(eventTypes()).toEqual(['refund-started', 'refunded', 'refund-completed']);
  });

  it('refunds and charges the fees of a late cancellation, with the booking in the invoice', async () => {
    await start();

    const outcome = await executeRefund(setup.deps, await plan(10));

    expect(outcome).toMatchObject({ kind: 'done', missingAmount: 0, feeAmount: 15 });
    expect(feeCharges()).toHaveLength(1);
    expect(feeCharges()[0]?.body).toEqual({
      productId: refundSettings().cancellationFeesProductId,
      amount: 15,
      userId: 'customer-1',
      entityId: 'entity-1',
      originId: 'operator-1',
      productNotes: 'Schedule a trip booking-1 – cancellation fees',
      additionalInfo: { bookingRequestId: BOOKING_ID },
    });
    expect(setup.aima.callsTo('PATCH', '/wallets/wallet-1')).toEqual([]);
    expect(eventTypes()).toEqual(['refund-started', 'refunded', 'cancellation-fee-started', 'cancellation-fee-charged', 'refund-completed']);
    expect(setup.stored()?.expiresAt).toBeTruthy();
  });

  it('revokes the credits; nothing to regularize when they cover the fees', async () => {
    await start({ balance: 40 });

    const outcome = await executeRefund(setup.deps, await plan(0.5));

    expect(outcome).toMatchObject({ kind: 'done', missingAmount: 0 });
    expect(setup.aima.callsTo('PATCH', '/wallets/wallet-1')[0]?.body).toEqual([
      { op: 'replace', path: '/availableAmount', value: '0' },
    ]);
    expect(setup.aima.wallets.get('wallet-1')?.availableAmount).toBe(0);
    expect(setup.stored()?.value).toMatchObject({ creditsRevoked: true });
    expect(setup.stored()?.value.toRegularize).toBeUndefined();
    expect(setup.stored()?.expiresAt).toBeTruthy();
  });

  it('records the fees left unpaid by the credits, without starting the expiry', async () => {
    await start({ balance: 5 });

    const outcome = await executeRefund(setup.deps, await plan(0.5));

    expect(outcome).toMatchObject({ kind: 'done', missingAmount: 10, feeAmount: 15 });
    expect(setup.stored()?.value).toMatchObject({
      creditsRevoked: true,
      regularizationPending: true,
      toRegularize: { missingAmount: 10 },
    });
    expect(setup.stored()?.expiresAt).toBeUndefined();
  });

  it('skips the revocation when no credits were granted', async () => {
    await start({ state: { walletId: null, creditsAdded: false } });

    const outcome = await executeRefund(setup.deps, await plan(0.5));

    expect(outcome).toMatchObject({ kind: 'done', missingAmount: 0 });
    expect(setup.aima.callsTo('GET', '/wallet/entity/entity-1')).toEqual([]);
    expect(eventTypes()).toContain('credits-revocation-skipped');
  });

  it('records nothing as refunded when the API refuses the refund', async () => {
    await start();
    setup.aima.failNext('refund', { status: 400 });

    expect(await executeRefund(setup.deps, await plan(10))).toMatchObject({ kind: 'refund-refused' });
    expect(setup.stored()?.value.refundedAt).toBeUndefined();
    expect(feeCharges()).toEqual([]);
  });

  it('resumes a refund whose answer was lost: records it from the invoice, never refunds twice', async () => {
    await start();
    setup.aima.failNext('refund', { reject: new TypeError('Failed to fetch') });
    expect(await executeRefund(setup.deps, await plan(10))).toMatchObject({ kind: 'refund-unknown' });
    // The refund went through on the API side.
    const invoice = setup.aima.invoices.get('invoice-1');
    if (invoice) {
      invoice.status = 'REFUNDED';
      invoice.refundable = 0;
    }

    const resumed = await plan(10);
    expect(resumed).toMatchObject({ refund: null, recordRefundOnly: true });
    expect(await executeRefund(setup.deps, resumed)).toMatchObject({ kind: 'done', feeAmount: 15 });
    expect(setup.aima.callsTo('POST', '/refund')).toHaveLength(1);
    expect(feeCharges()).toHaveLength(1);
  });

  it('resumes after the fees were refused: charges them once', async () => {
    await start();
    setup.aima.failNext('charge', { status: 400 });
    expect(await executeRefund(setup.deps, await plan(10))).toMatchObject({ kind: 'fee-refused' });
    expect(setup.stored()?.value.refundedAt).toBeTruthy();

    const resumed = await plan(10);
    expect(resumed.refund).toBeNull();
    expect(await executeRefund(setup.deps, resumed)).toMatchObject({ kind: 'done' });
    expect(setup.aima.callsTo('POST', '/refund')).toHaveLength(1);
    expect(feeCharges()).toHaveLength(2);
    expect(setup.aima.invoices.size).toBe(2);
  });

  it('never charges the fees again after a lost answer until the operator says they were not', async () => {
    await start();
    setup.aima.failNext('charge', { reject: new TypeError('Failed to fetch') });
    expect(await executeRefund(setup.deps, await plan(10))).toMatchObject({ kind: 'fee-unknown' });

    const resumed = await plan(10);
    expect(resumed.feeInDoubt).toBe(true);
    expect(await executeRefund(setup.deps, resumed)).toEqual({ kind: 'fee-in-doubt' });
    expect(feeCharges()).toHaveLength(1);

    expect(await executeRefund(setup.deps, resumed, 'charged')).toMatchObject({ kind: 'done', feeAmount: 15 });
    expect(feeCharges()).toHaveLength(1);
    expect(eventTypes()).toContain('cancellation-fee-confirmed');
  });

  it('charges the fees again when the operator says the lost one was not charged', async () => {
    await start();
    setup.aima.failNext('charge', { status: 503 });
    expect(await executeRefund(setup.deps, await plan(10))).toMatchObject({ kind: 'fee-unknown' });

    expect(await executeRefund(setup.deps, await plan(10), 'not-charged')).toMatchObject({ kind: 'done' });
    expect(feeCharges()).toHaveLength(2);
    expect(eventTypes()).toContain('cancellation-fee-released');
  });

  it('resumes a failed revocation with the balance read before it', async () => {
    await start({ balance: 5 });
    setup.aima.failNext('wallet-patch', { status: 500 });
    expect(await executeRefund(setup.deps, await plan(0.5))).toMatchObject({ kind: 'credits-failed' });
    // Emptied meanwhile: the recorded balance still decides what is missing.
    const wallet = setup.aima.wallets.get('wallet-1');
    if (wallet) wallet.availableAmount = 0;

    const resumed = await plan(0.5);
    expect(resumed.credits).toEqual({ kind: 'revoke', walletId: 'wallet-1', balance: 5 });
    expect(await executeRefund(setup.deps, resumed)).toMatchObject({ kind: 'done', missingAmount: 10 });
    expect(feeCharges()).toHaveLength(1);
  });

  it('refuses the second of two operators who planned at the same time', async () => {
    await start();
    const first = await plan(48);
    const second = await plan(48);

    expect(await executeRefund(setup.deps, first)).toMatchObject({ kind: 'done' });
    expect(await executeRefund(setup.deps, second)).toEqual({
      kind: 'write-failed',
      step: 'refund',
      failure: { kind: 'refused', reason: 'already-refunded' },
    });
    expect(setup.aima.callsTo('POST', '/refund')).toHaveLength(1);
  });

  it('says complete once done', async () => {
    await start();
    await executeRefund(setup.deps, await plan(48));
    const read = await readBookingState(setup.collection, BOOKING_ID);
    const planned = await planRefund(setup.deps, { booking: cancelledBefore(48), doc: read.ok ? read.value : null, settings: refundSettings() });
    expect(planned).toEqual({ ok: false, error: { kind: 'complete' } });
  });

  it('skips a fee product priced 0', async () => {
    await start({ price: 0 });
    expect(await executeRefund(setup.deps, await plan(10))).toMatchObject({ kind: 'done', feeAmount: 0 });
    expect(feeCharges()).toEqual([]);
    expect(eventTypes()).toContain('cancellation-fee-skipped');
  });
});
