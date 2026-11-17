import { afterEach, describe, expect, it } from 'vitest';
import { hostError } from '../../test/fake-bo';
import { fakeInvoice } from '../../test/fake-aima';
import { BOOKING_ID, booking, moneySetup, NOW, settings } from '../../test/prepayment-fixtures';
import { readBookingState } from '../../storage/booking-state';
import {
  attachInvoice,
  chargePrepayment,
  searchClaimedInvoice,
  unlockClaim,
  type ChargeRequest,
} from './charge';

let setup: Awaited<ReturnType<typeof moneySetup>>;
afterEach(() => setup?.disconnect());

const request = (overrides: Partial<ChargeRequest> = {}): ChargeRequest => ({
  booking: booking(),
  entityId: 'entity-1',
  amount: 50,
  computedAmount: 50,
  warnings: [],
  productId: settings().prepaymentProductId,
  settings: settings(),
  ...overrides,
});

describe('chargePrepayment', () => {
  it('claims, then creates the invoice, then records it', async () => {
    setup = await moneySetup();

    const outcome = await chargePrepayment(setup.deps, request({ amount: 60, warnings: ['above-computed'] }));

    expect(outcome.kind).toBe('charged');
    const [charge] = setup.aima.callsTo('POST', '/invoices/product');
    expect(charge?.body).toEqual({
      productId: settings().prepaymentProductId,
      amount: 60,
      userId: 'customer-1',
      entityId: 'entity-1',
      originId: 'operator-1',
      productNotes: 'Schedule a trip booking-1 – 14 h',
    });
    // The claim was written before the call.
    expect(setup.bo.storage.api.set.mock.invocationCallOrder[0]).toBeLessThan(
      setup.aima.authFetch.mock.invocationCallOrder[0] ?? 0,
    );
    expect(setup.stored()?.value).toMatchObject({
      invoiceId: 'invoice-new-1',
      chargeAmount: 60,
      computedAmount: 50,
      amountWarnings: ['above-computed'],
      entityId: 'entity-1',
      isB2B: false,
      chargeStartedBy: 'operator-1',
    });
    expect((setup.stored()?.value.events as { type: string }[]).map((event) => event.type)).toEqual([
      'charge-started',
      'charged',
    ]);
  });

  it('releases the claim and its amounts when the API refuses the invoice', async () => {
    setup = await moneySetup();
    setup.aima.failNext('charge', { status: 400 });

    const outcome = await chargePrepayment(setup.deps, request());

    expect(outcome).toMatchObject({ kind: 'refused', error: { kind: 'http', status: 400 }, releaseFailure: null });
    expect(setup.stored()?.value).toMatchObject({
      chargeStartedAt: null,
      chargeAmount: null,
      computedAmount: null,
      amountWarnings: [],
    });
  });

  it('releases the claim on a 403 and says not-allowed', async () => {
    setup = await moneySetup();
    setup.aima.failNext('charge', { status: 403 });

    const outcome = await chargePrepayment(setup.deps, request());

    expect(outcome).toMatchObject({ kind: 'refused', error: { kind: 'not-allowed' } });
    expect(setup.stored()?.value.chargeStartedAt).toBeNull();
  });

  it.each([
    ['a lost answer', { reject: new TypeError('Failed to fetch') }],
    ['a 5xx', { status: 502 }],
  ])('keeps the claim after %s: the invoice may exist', async (_, failure) => {
    setup = await moneySetup();
    setup.aima.failNext('charge', failure);

    const outcome = await chargePrepayment(setup.deps, request());

    expect(outcome.kind).toBe('to-verify');
    expect(setup.stored()?.value).toMatchObject({ chargeStartedAt: NOW.toISOString(), chargeAmount: 50 });
    expect(setup.stored()?.value.invoiceId).toBeUndefined();
  });

  it('keeps the claim when the answer gives no invoice id', async () => {
    setup = await moneySetup();
    setup.aima.authFetch.mockResolvedValueOnce(new Response('', { status: 201 }));

    expect(await chargePrepayment(setup.deps, request())).toEqual({ kind: 'to-verify', error: null });
    expect(setup.stored()?.value.chargeStartedAt).toBe(NOW.toISOString());
  });

  it('sends nothing when the booking is already claimed', async () => {
    setup = await moneySetup();
    await setup.seed({ chargeStartedAt: NOW.toISOString(), chargeStartedBy: 'operator-2', chargeAmount: 50 });

    const outcome = await chargePrepayment(setup.deps, request());

    expect(outcome).toMatchObject({ kind: 'not-claimed', failure: { kind: 'already-in-progress' } });
    expect(setup.aima.calls).toEqual([]);
  });

  it('sends nothing when the booking is already charged', async () => {
    setup = await moneySetup();
    await setup.seed({ chargeStartedAt: NOW.toISOString(), invoiceId: 'invoice-1' });

    const outcome = await chargePrepayment(setup.deps, request());

    expect(outcome).toMatchObject({ kind: 'not-claimed', failure: { kind: 'already-charged' } });
    expect(setup.aima.calls).toEqual([]);
  });

  it('sends nothing when the claim write has an unknown outcome', async () => {
    setup = await moneySetup();
    setup.bo.storage.api.set.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'TIMEOUT' }));

    const outcome = await chargePrepayment(setup.deps, request());

    expect(outcome.kind).toBe('not-claimed');
    expect(setup.aima.calls).toEqual([]);
  });

  it.each([0, -5, Number.NaN])('refuses the amount %s without writing', async (amount) => {
    setup = await moneySetup();
    expect(await chargePrepayment(setup.deps, request({ amount }))).toEqual({ kind: 'invalid', reason: 'amount' });
    expect(setup.stored()).toBeUndefined();
  });

  it('refuses a booking without a customer', async () => {
    setup = await moneySetup();
    const outcome = await chargePrepayment(setup.deps, request({ booking: booking({ userId: null }) }));
    expect(outcome).toEqual({ kind: 'invalid', reason: 'customer' });
  });

  it('says charged-unrecorded when the invoice cannot be written, keeping the claim', async () => {
    setup = await moneySetup();
    // The claim is a `set`; every later update fails.
    setup.bo.storage.api.update.mockRejectedValue(hostError('quota-exceeded', 507));

    const outcome = await chargePrepayment(setup.deps, request());

    expect(outcome).toMatchObject({ kind: 'charged-unrecorded', invoiceId: 'invoice-new-1' });
    expect(setup.stored()?.value.chargeStartedAt).toBe(NOW.toISOString());
  });

  it('says refused with the release failure when the claim cannot be released', async () => {
    setup = await moneySetup();
    setup.aima.failNext('charge', { status: 422 });
    setup.bo.storage.api.update.mockRejectedValue(hostError('quota-exceeded', 507));

    const outcome = await chargePrepayment(setup.deps, request());

    expect(outcome).toMatchObject({ kind: 'refused', doc: null, releaseFailure: { kind: 'quota-exceeded' } });
  });
});

describe('searchClaimedInvoice', () => {
  const claimed = async (amount = 50) => {
    await setup.seed({ chargeStartedAt: NOW.toISOString(), chargeStartedBy: 'operator-1', chargeAmount: amount });
    const read = await readBookingState(setup.collection, BOOKING_ID);
    if (!read.ok || !read.value) throw new Error('not seeded');
    return read.value;
  };
  const input = async () => ({ booking: booking(), doc: await claimed(), productId: settings().prepaymentProductId });

  it('finds the invoice of a charge whose answer was lost, and searches from before the claim', async () => {
    setup = await moneySetup();
    setup.aima.loseNextChargeAnswer();
    expect((await chargePrepayment(setup.deps, request())).kind).toBe('to-verify');
    const read = await readBookingState(setup.collection, BOOKING_ID);
    if (!read.ok || !read.value) throw new Error('not claimed');

    const outcome = await searchClaimedInvoice(setup.deps, {
      booking: booking(),
      doc: read.value,
      productId: settings().prepaymentProductId,
    });

    expect(outcome).toMatchObject({ kind: 'found', invoices: [{ id: 'invoice-new-1', amount: 50 }] });
    const [list] = setup.aima.callsTo('GET', '/invoices');
    const query = new URLSearchParams(list?.path.split('?')[1]);
    expect(query.get('startDate')).toBe('2026-03-10T07:50:00.000Z');
    expect(query.get('minAmount')).toBe('50');
    expect(query.get('maxAmount')).toBe('50');
  });

  it('ignores an invoice of the same amount for another booking, customer or product', async () => {
    setup = await moneySetup({
      invoices: [
        fakeInvoice({ id: 'other-booking', productNotes: 'Schedule a trip booking-2 – 12 h' }),
        fakeInvoice({ id: 'other-customer', userId: 'customer-2' }),
        fakeInvoice({ id: 'other-product', productId: 'product-x' }),
      ],
    });
    expect(await searchClaimedInvoice(setup.deps, await input())).toEqual({ kind: 'none' });
  });

  it('lists several matches: a double charge', async () => {
    setup = await moneySetup({ invoices: [fakeInvoice({ id: 'a' }), fakeInvoice({ id: 'b' })] });
    const outcome = await searchClaimedInvoice(setup.deps, await input());
    expect(outcome.kind === 'found' && outcome.invoices.map((invoice) => invoice.id)).toEqual(['a', 'b']);
  });

  it('says failed, never none, when the API fails', async () => {
    setup = await moneySetup();
    setup.aima.failNext('invoices-list', { status: 500 });
    expect(await searchClaimedInvoice(setup.deps, await input())).toMatchObject({ kind: 'failed' });
  });

  it('reads every page before saying none, and says incomplete past the last one', async () => {
    const many = Array.from({ length: 2000 }, (_, index) =>
      fakeInvoice({ id: `noise-${index}`, productNotes: 'other' }),
    );
    setup = await moneySetup({ invoices: many });
    expect(await searchClaimedInvoice(setup.deps, await input())).toEqual({ kind: 'incomplete' });
    expect(setup.aima.callsTo('GET', '/invoices')).toHaveLength(20);
  });

  it('finds a match on a later page', async () => {
    const invoices = [
      ...Array.from({ length: 150 }, (_, index) => fakeInvoice({ id: `noise-${index}`, productNotes: 'other' })),
      fakeInvoice({ id: 'the-one' }),
    ];
    setup = await moneySetup({ invoices });
    const outcome = await searchClaimedInvoice(setup.deps, await input());
    expect(outcome).toMatchObject({ kind: 'found', invoices: [{ id: 'the-one' }] });
    expect(setup.aima.callsTo('GET', '/invoices')).toHaveLength(2);
  });

  it('says invalid without a claim or a customer', async () => {
    setup = await moneySetup();
    const base = await input();
    expect(
      await searchClaimedInvoice(setup.deps, { ...base, booking: booking({ userId: null }) }),
    ).toEqual({ kind: 'invalid' });
    expect(
      await searchClaimedInvoice(setup.deps, {
        ...base,
        doc: { ...base.doc, value: { ...base.doc.value, chargeStartedAt: null } },
      }),
    ).toEqual({ kind: 'invalid' });
  });
});

describe('attachInvoice', () => {
  it('records the invoice found and a journal entry', async () => {
    setup = await moneySetup();
    await setup.seed({ chargeStartedAt: NOW.toISOString(), chargeAmount: 50 });

    const written = await attachInvoice(setup.deps, BOOKING_ID, {
      id: 'invoice-9',
      status: 'PAID',
      userId: 'customer-1',
      entityId: 'entity-1',
      productId: 'p',
      productNotes: 'n',
      amount: 50,
      billingDate: null,
    });

    expect(written.ok && written.value.value).toMatchObject({ invoiceId: 'invoice-9', invoiceStatus: 'PAID' });
    expect(written.ok && written.value.value.events?.at(-1)?.type).toBe('charge-attached');
  });

  it('refuses when another invoice was recorded meanwhile', async () => {
    setup = await moneySetup();
    await setup.seed({ chargeStartedAt: NOW.toISOString(), invoiceId: 'invoice-other' });
    const written = await attachInvoice(setup.deps, BOOKING_ID, {
      id: 'invoice-9',
      status: null,
      userId: null,
      entityId: null,
      productId: null,
      productNotes: null,
      amount: null,
      billingDate: null,
    });
    expect(written).toEqual({ ok: false, error: { kind: 'refused', reason: 'other-invoice' } });
  });
});

describe('unlockClaim', () => {
  it('refuses a claim younger than 10 minutes', async () => {
    setup = await moneySetup();
    await setup.seed({ chargeStartedAt: NOW.toISOString(), chargeAmount: 50 });
    setup.setNow(new Date(NOW.getTime() + 9 * 60_000));

    expect(await unlockClaim(setup.deps, BOOKING_ID)).toEqual({ ok: false, error: { kind: 'too-recent' } });
    expect(setup.stored()?.value.chargeStartedAt).toBe(NOW.toISOString());
  });

  it('releases an old claim without an invoice', async () => {
    setup = await moneySetup();
    await setup.seed({ chargeStartedAt: NOW.toISOString(), chargeStartedBy: 'operator-2', chargeAmount: 50 });
    setup.setNow(new Date(NOW.getTime() + 10 * 60_000));

    const released = await unlockClaim(setup.deps, BOOKING_ID);

    expect(released.ok && released.value.value).toMatchObject({ chargeStartedAt: null, chargeAmount: null });
  });

  it('refuses without a claim, or once an invoice is known', async () => {
    setup = await moneySetup();
    expect(await unlockClaim(setup.deps, BOOKING_ID)).toEqual({ ok: false, error: { kind: 'no-claim' } });
    await setup.seed({ chargeStartedAt: NOW.toISOString(), invoiceId: 'invoice-1' });
    expect(await unlockClaim(setup.deps, BOOKING_ID)).toMatchObject({ ok: false, error: { kind: 'already-charged' } });
  });
});
