import { afterEach, describe, expect, it } from 'vitest';
import { hostError } from '../../test/fake-bo';
import { fakeInvoice } from '../../test/fake-aima';
import { BOOKING_ID, moneySetup, NOW } from '../../test/prepayment-fixtures';
import { retryPrepayment } from './retry';

let setup: Awaited<ReturnType<typeof moneySetup>>;
afterEach(() => setup?.disconnect());

const start = async (status: string) => {
  setup = await moneySetup({ invoices: [fakeInvoice({ status })] });
  await setup.seed({ chargeStartedAt: NOW.toISOString(), invoiceId: 'invoice-1', invoiceStatus: status });
};

describe('retryPrepayment', () => {
  it.each(['REFUSED', 'ERROR'])('retries an invoice %s and records the new status', async (status) => {
    await start(status);

    const outcome = await retryPrepayment(setup.deps, { bookingId: BOOKING_ID, invoiceId: 'invoice-1' });

    expect(outcome).toMatchObject({ kind: 'retried', status: 'PENDING', recordFailure: null });
    expect(setup.aima.callsTo('POST', '/invoices/invoice-1/retry-payment')).toHaveLength(1);
    expect(setup.stored()?.value).toMatchObject({ invoiceStatus: 'PENDING' });
    expect((setup.stored()?.value.events as { type: string }[]).at(-1)?.type).toBe('payment-retried');
  });

  it.each(['PENDING', 'PAID', 'MOP_MISSING', 'REFUNDED'])('sends nothing for an invoice %s', async (status) => {
    await start(status);
    expect(await retryPrepayment(setup.deps, { bookingId: BOOKING_ID, invoiceId: 'invoice-1' })).toEqual({ kind: 'not-retryable', status });
    expect(setup.aima.callsTo('POST', '/retry-payment')).toEqual([]);
  });

  it('gives the refusal of the API, a 403 included', async () => {
    await start('REFUSED');
    setup.aima.failNext('retry', { status: 403 });
    expect(await retryPrepayment(setup.deps, { bookingId: BOOKING_ID, invoiceId: 'invoice-1' })).toEqual({
      kind: 'failed',
      error: { kind: 'not-allowed', status: 403 },
    });
  });

  it('fails when the invoice cannot be read', async () => {
    await start('REFUSED');
    setup.aima.failNext('invoice', { status: 500 });
    expect(await retryPrepayment(setup.deps, { bookingId: BOOKING_ID, invoiceId: 'invoice-1' })).toMatchObject({ kind: 'failed' });
  });

  it('keeps the retry done when the journal cannot be written, and says so', async () => {
    await start('ERROR');
    setup.bo.storage.api.update.mockRejectedValue(hostError('quota-exceeded', 507));
    expect(await retryPrepayment(setup.deps, { bookingId: BOOKING_ID, invoiceId: 'invoice-1' })).toMatchObject({
      kind: 'retried',
      doc: null,
      recordFailure: { kind: 'quota-exceeded' },
    });
  });

  it('records the retry without a status when the second read fails', async () => {
    await start('ERROR');
    let reads = 0;
    const authFetch: typeof setup.deps.authFetch = async (input, init) => {
      const path = String(input);
      if ((init?.method ?? 'GET') === 'GET' && path.endsWith('/invoices/invoice-1')) {
        reads += 1;
        if (reads === 2) return new Response('{}', { status: 500 });
      }
      return setup.aima.authFetch(input, init);
    };

    const outcome = await retryPrepayment({ ...setup.deps, authFetch }, { bookingId: BOOKING_ID, invoiceId: 'invoice-1' });

    expect(outcome).toMatchObject({ kind: 'retried', status: null, recordFailure: null });
    expect(setup.stored()?.value.invoiceStatus).toBe('ERROR');
  });
});
