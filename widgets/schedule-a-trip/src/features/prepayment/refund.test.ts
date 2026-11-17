import { afterEach, describe, expect, it } from 'vitest';
import { fakeInvoice } from '../../test/fake-aima';
import { BOOKING_ID, booking, moneySetup, NOW, settings } from '../../test/prepayment-fixtures';
import type { BookingState } from '../../storage/booking-state';
import { readBookingState } from '../../storage/booking-state';
import { saveInternalNotes } from './notes';
import { executeRefund, planRefund, refundAmounts, type RefundPlan } from './refund';

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
      refund: { kind: 'call', amount: 50, pspReference: 'psp-1' },
      policy: { kind: 'refund-with-fee-and-credits-revocation', hoursBeforeStart: 0.5 },
      fee: { kind: 'charge', amount: 15, userId: 'customer-1', entityId: 'entity-1' },
      credits: { kind: 'revoke', walletId: 'wallet-1', balance: 5 },
      balance: 5,
    });
    expect(refundAmounts(planned)).toEqual({ fee: 15, missing: 10 });
    expect(setup.bo.storage.api.update).not.toHaveBeenCalled();
    expect(setup.aima.calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('plans a full refund without fees nor wallet calls when cancelled early', async () => {
    await start();
    const planned = await plan(48);
    expect(planned).toMatchObject({ fee: { kind: 'none' }, credits: { kind: 'none' }, balance: null });
    expect(refundAmounts(planned)).toEqual({ fee: 0, missing: 0 });
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
      // Each money step in its own fields, the journal as audit.
      refundStartedAt: NOW.toISOString(),
      refundStartedBy: 'operator-1',
      refundAmount: 50,
      refundOutcome: 'confirmed',
      feeStartedAt: NOW.toISOString(),
      feeAmount: 15,
      walletBalanceBeforeFee: 5,
      feeOutcome: 'charged',
      feeChargedAt: NOW.toISOString(),
      creditsRevocationStartedAt: NOW.toISOString(),
      creditsRevocationBalance: 5,
      refundCompletedAt: NOW.toISOString(),
    });
    expect(setup.stored()?.value.feeInvoiceId).toMatch(/^invoice-new-/);
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
    expect(resumed.refund).toEqual({ kind: 'record-only' });
    expect(await executeRefund(setup.deps, resumed)).toMatchObject({ kind: 'done', feeAmount: 15 });
    expect(setup.aima.callsTo('POST', '/refund')).toHaveLength(1);
    expect(feeCharges()).toHaveLength(1);
  });

  it('records a lost refund when the invoice is still PAID but has nothing left to refund', async () => {
    await start();
    setup.aima.failNext('refund', { status: 504 });
    await executeRefund(setup.deps, await plan(48));
    const invoice = setup.aima.invoices.get('invoice-1');
    if (invoice) invoice.refundable = 0;

    expect((await plan(48)).refund).toEqual({ kind: 'record-only' });
  });

  it('asks the operator about a lost refund the invoice does not show, never refunding on its own', async () => {
    await start();
    setup.aima.failNext('refund', { reject: new TypeError('Failed to fetch') });
    await executeRefund(setup.deps, await plan(48));

    const recent = await plan(48);
    expect(recent.refund).toMatchObject({ kind: 'in-doubt', canDecide: false });
    expect(await executeRefund(setup.deps, recent, { refund: 'not-refunded' })).toEqual({ kind: 'needs-decision', step: 'refund', tooRecent: true });
    expect(setup.aima.callsTo('POST', '/refund')).toHaveLength(1);

    setup.setNow(new Date(NOW.getTime() + 11 * 60_000));
    const old = await plan(48);
    expect(await executeRefund(setup.deps, old)).toEqual({ kind: 'needs-decision', step: 'refund', tooRecent: false });
    expect(await executeRefund(setup.deps, old, { refund: 'refunded' })).toMatchObject({ kind: 'done' });
    expect(setup.aima.callsTo('POST', '/refund')).toHaveLength(1);
    expect(eventTypes()).toContain('refund-confirmed');
    expect(setup.stored()?.value).toMatchObject({
      refundOutcome: 'confirmed',
      refundDecidedAt: new Date(NOW.getTime() + 11 * 60_000).toISOString(),
      refundDecidedBy: 'operator-1',
    });
  });

  it('records a confirmed refund whose record failed, without refunding again', async () => {
    await start();
    setup.aima.failNext('refund', { reject: new TypeError('Failed to fetch') });
    await executeRefund(setup.deps, await plan(10));
    setup.setNow(new Date(NOW.getTime() + 11 * 60_000));
    const resumed = await plan(10);
    // The decision is written, then the record of the refund fails.
    const update = setup.bo.storage.api.update;
    const real = update.getMockImplementation();
    let writes = 0;
    update.mockImplementation(async (...args) => {
      writes += 1;
      if (writes === 2) throw Object.assign(new Error('quota'), { code: 'quota-exceeded', status: 507 });
      return real!(...args);
    });
    expect(await executeRefund(setup.deps, resumed, { refund: 'refunded' })).toMatchObject({ kind: 'write-failed', step: 'refund' });
    update.mockImplementation(real!);

    const again = await plan(10);
    expect(again.refund).toEqual({ kind: 'record-only' });
    const stale = { ...again, refund: { kind: 'call' as const, amount: 50, currency: 'EUR', pspReference: null } };
    expect(await executeRefund(setup.deps, stale)).toMatchObject({ kind: 'write-failed', failure: { reason: 'refund-in-progress' } });
    expect(await executeRefund(setup.deps, again)).toMatchObject({ kind: 'done' });
    expect(setup.aima.callsTo('POST', '/refund')).toHaveLength(1);
  });

  it('refunds again only when the operator says the lost refund was not done', async () => {
    await start();
    setup.aima.failNext('refund', { status: 502 });
    await executeRefund(setup.deps, await plan(48));
    setup.setNow(new Date(NOW.getTime() + 11 * 60_000));

    expect(await executeRefund(setup.deps, await plan(48), { refund: 'not-refunded' })).toMatchObject({ kind: 'done' });
    expect(setup.aima.callsTo('POST', '/refund')).toHaveLength(2);
    expect(eventTypes()).toContain('refund-released');
    // The new call started after the decision: the step is a new one, the decision stays in the journal.
    expect(setup.stored()?.value).toMatchObject({ refundOutcome: 'confirmed', refundDecidedAt: null });
  });

  it('refunds once when two operators run the same refund at the same time', async () => {
    await start();
    const first = await plan(48);
    const second = await plan(48);

    const outcomes = await Promise.all([executeRefund(setup.deps, first), executeRefund(setup.deps, second)]);

    expect(setup.aima.callsTo('POST', '/refund')).toHaveLength(1);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['done', 'write-failed']);
    expect(setup.stored()?.value).toMatchObject({ refundOutcome: 'confirmed', refundCompletedAt: NOW.toISOString() });
  });

  it('charges the fees once when two operators resume the same refund at the same time', async () => {
    await start({ balance: 40 });
    const first = await plan(0.5);
    const second = await plan(0.5);

    await Promise.all([executeRefund(setup.deps, first), executeRefund(setup.deps, second)]);

    expect(feeCharges()).toHaveLength(1);
    expect(setup.aima.callsTo('POST', '/refund')).toHaveLength(1);
    expect(setup.stored()?.value.feeOutcome).toBe('charged');
  });

  it('decides from the fields, whatever the journal says', async () => {
    // The journal says a refund was started; the fields say nothing was: the fields win.
    await start({ state: { events: [{ at: NOW.toISOString(), by: 'operator-1', type: 'refund-started' }] } });

    expect(await executeRefund(setup.deps, await plan(48))).toMatchObject({ kind: 'done' });
    expect(setup.aima.callsTo('POST', '/refund')).toHaveLength(1);
  });

  it('refuses a second refund while another one is started and not recorded', async () => {
    await start();
    const first = await plan(48);
    const second = await plan(48);
    setup.aima.failNext('refund', { reject: new TypeError('Failed to fetch') });
    expect(await executeRefund(setup.deps, first)).toMatchObject({ kind: 'refund-unknown' });

    expect(await executeRefund(setup.deps, second)).toEqual({
      kind: 'write-failed',
      step: 'refund',
      failure: { kind: 'refused', reason: 'refund-in-progress' },
    });
    expect(setup.aima.callsTo('POST', '/refund')).toHaveLength(1);
  });

  it('refunds the refundable amount when part was refunded elsewhere', async () => {
    await start();
    const invoice = setup.aima.invoices.get('invoice-1');
    if (invoice) invoice.refundable = 30;
    expect((await plan(48)).refund).toMatchObject({ kind: 'call', amount: 30 });
    await executeRefund(setup.deps, await plan(48));
    expect(setup.aima.callsTo('POST', '/refund')[0]?.body).toMatchObject({ amount: 30 });
  });

  it('resumes after the fees were refused: charges them once', async () => {
    await start();
    setup.aima.failNext('charge', { status: 400 });
    expect(await executeRefund(setup.deps, await plan(10))).toMatchObject({ kind: 'fee-refused', releaseFailure: null });
    expect(setup.stored()?.value.refundedAt).toBeTruthy();

    const resumed = await plan(10);
    expect(resumed.refund).toEqual({ kind: 'done' });
    expect(await executeRefund(setup.deps, resumed)).toMatchObject({ kind: 'done' });
    expect(setup.aima.callsTo('POST', '/refund')).toHaveLength(1);
    expect(feeCharges()).toHaveLength(2);
    expect(setup.aima.invoices.size).toBe(2);
  });

  it('never charges the fees again after a lost answer until the operator says they were not', async () => {
    await start();
    setup.aima.failNext('charge', { reject: new TypeError('Failed to fetch') });
    expect(await executeRefund(setup.deps, await plan(10))).toMatchObject({ kind: 'fee-unknown' });

    const recent = await plan(10);
    expect(recent.fee).toMatchObject({ kind: 'in-doubt', canDecide: false, previousAmount: 15 });
    expect(await executeRefund(setup.deps, recent, { fee: 'charged' })).toEqual({ kind: 'needs-decision', step: 'fee', tooRecent: true });

    setup.setNow(new Date(NOW.getTime() + 11 * 60_000));
    const resumed = await plan(10);
    expect(await executeRefund(setup.deps, resumed)).toEqual({ kind: 'needs-decision', step: 'fee', tooRecent: false });
    expect(feeCharges()).toHaveLength(1);

    expect(await executeRefund(setup.deps, resumed, { fee: 'charged' })).toMatchObject({ kind: 'done', feeAmount: 15 });
    expect(feeCharges()).toHaveLength(1);
    expect(eventTypes()).toContain('cancellation-fee-confirmed');
    expect(setup.stored()?.value).toMatchObject({
      feeOutcome: 'confirmed',
      feeAmount: 15,
      feeDecidedAt: new Date(NOW.getTime() + 11 * 60_000).toISOString(),
      feeDecidedBy: 'operator-1',
    });
  });

  it('charges the fees again when the operator says the lost one was not charged', async () => {
    await start();
    setup.aima.failNext('charge', { status: 503 });
    expect(await executeRefund(setup.deps, await plan(10))).toMatchObject({ kind: 'fee-unknown' });
    setup.setNow(new Date(NOW.getTime() + 11 * 60_000));

    expect(await executeRefund(setup.deps, await plan(10), { fee: 'not-charged' })).toMatchObject({ kind: 'done' });
    expect(feeCharges()).toHaveLength(2);
    expect(eventTypes()).toContain('cancellation-fee-released');
  });

  it('refuses a decision taken on a stale plan', async () => {
    await start();
    setup.aima.failNext('charge', { status: 503 });
    await executeRefund(setup.deps, await plan(10));
    setup.setNow(new Date(NOW.getTime() + 11 * 60_000));
    const first = await plan(10);
    const stale = await plan(10);

    expect(await executeRefund(setup.deps, first, { fee: 'not-charged' })).toMatchObject({ kind: 'done' });
    expect(await executeRefund(setup.deps, stale, { fee: 'not-charged' })).toEqual({
      kind: 'write-failed',
      step: 'decision',
      failure: { kind: 'refused', reason: 'fee-not-in-doubt' },
    });
    expect(feeCharges()).toHaveLength(2);
  });

  it('refuses the fee step to the second of two operators resuming at the same time', async () => {
    await start();
    setup.aima.failNext('charge', { status: 400 });
    await executeRefund(setup.deps, await plan(10));
    const first = await plan(10);
    const second = await plan(10);

    expect(await executeRefund(setup.deps, first)).toMatchObject({ kind: 'done' });
    expect(await executeRefund(setup.deps, second)).toEqual({
      kind: 'write-failed',
      step: 'fee',
      failure: { kind: 'refused', reason: 'fee-started' },
    });
    expect(feeCharges()).toHaveLength(2);
  });

  it('says the fees were charged when they cannot be recorded, and never charges them again', async () => {
    await start();
    const original = setup.aima.authFetch.getMockImplementation();
    setup.aima.authFetch.mockImplementation(async (input, init) => {
      const response = await original!(input, init);
      if (String(input).endsWith('/invoices/product')) {
        setup.bo.storage.api.update.mockRejectedValue(Object.assign(new Error('quota'), { code: 'quota-exceeded', status: 507 }));
      }
      return response;
    });

    expect(await executeRefund(setup.deps, await plan(10))).toMatchObject({
      kind: 'fee-charged-unrecorded',
      invoiceId: 'invoice-new-1',
      amount: 15,
      failure: { kind: 'quota-exceeded' },
    });
  });

  it('keeps the money steps when the journal fills up', async () => {
    await start();
    setup.aima.failNext('charge', { status: 503 });
    await executeRefund(setup.deps, await plan(10));
    for (let index = 0; index < 60; index++) {
      const notes = setup.stored()?.value.internalNotes as string | undefined;
      await saveInternalNotes(setup.deps, BOOKING_ID, `note ${index}`, notes ?? '');
    }
    expect((setup.stored()?.value.events as unknown[]).length).toBe(50);

    const resumed = await plan(10);
    expect(resumed.fee.kind).toBe('in-doubt');
    expect(resumed.refund).toEqual({ kind: 'done' });
  });

  it('stays complete when the journal fills up after the refund', async () => {
    await start();
    await executeRefund(setup.deps, await plan(10));
    for (let index = 0; index < 60; index++) {
      const notes = setup.stored()?.value.internalNotes as string | undefined;
      await saveInternalNotes(setup.deps, BOOKING_ID, `note ${index}`, notes ?? '');
    }
    const read = await readBookingState(setup.collection, BOOKING_ID);
    const planned = await planRefund(setup.deps, { booking: cancelledBefore(10), doc: read.ok ? read.value : null, settings: refundSettings() });
    expect(planned).toEqual({ ok: false, error: { kind: 'complete' } });
  });

  it('computes the regularization from the balance read before the fees', async () => {
    await start({ balance: 5 });
    setup.aima.failNext('charge', { status: 503 });
    expect(await executeRefund(setup.deps, await plan(0.5))).toMatchObject({ kind: 'fee-unknown' });
    // The fees were paid with the credits meanwhile.
    const wallet = setup.aima.wallets.get('wallet-1');
    if (wallet) wallet.availableAmount = 0;
    setup.setNow(new Date(NOW.getTime() + 11 * 60_000));

    const resumed = await plan(0.5);
    expect(resumed.credits).toEqual({ kind: 'revoke', walletId: 'wallet-1', balance: 5 });
    expect(await executeRefund(setup.deps, resumed, { fee: 'charged' })).toMatchObject({ kind: 'done', missingAmount: 10 });
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

  it('refuses a wallet without a balance and a negative fee price', async () => {
    await start();
    const wallet = setup.aima.wallets.get('wallet-1') as { availableAmount: unknown } | undefined;
    if (wallet) wallet.availableAmount = null;
    const read = await readBookingState(setup.collection, BOOKING_ID);
    const doc = read.ok ? read.value : null;
    expect(await planRefund(setup.deps, { booking: cancelledBefore(0.5), doc, settings: refundSettings() })).toEqual({ ok: false, error: { kind: 'wallet-balance-unknown' } });
    setup.aima.setProductPrice(-1);
    expect(await planRefund(setup.deps, { booking: cancelledBefore(10), doc, settings: refundSettings() })).toEqual({ ok: false, error: { kind: 'invalid-fee-price', price: -1 } });
  });

  it('skips a fee product priced 0', async () => {
    await start({ price: 0 });
    expect(await executeRefund(setup.deps, await plan(10))).toMatchObject({ kind: 'done', feeAmount: 0 });
    expect(feeCharges()).toEqual([]);
    expect(eventTypes()).toContain('cancellation-fee-skipped');
  });
});
