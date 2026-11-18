import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyText } from '../../test/dom';
import { hostError, VALID_SETTINGS } from '../../test/fake-bo';
import { BOOKING_ID, renderWithBilling } from '../../test/prepayment-fixtures';
import { usePrepaymentEnv } from './use-prepayment-env';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

function Probe() {
  const env = usePrepaymentEnv();
  return <span>{[env.fleetId, env.currency, env.deps ? 'deps' : 'no-deps', env.blocker?.key ?? 'ready', env.formatAmount(12.5)].join('|')}</span>;
}

describe('usePrepaymentEnv', () => {
  it('gives the dependencies, the currency of the settings and no blocker', async () => {
    const rendered = await renderWithBilling(<Probe />);
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(bodyText()).toBe('FLEET-1|EUR|deps|ready|€12.50'));
  });

  it('falls back on the currency of the fleet, or a plain number', async () => {
    const rendered = await renderWithBilling(<Probe />, {
      bo: {
        getSettings: async () => ({ ...VALID_SETTINGS }),
        getContext: async () => ({ fleetId: 'FLEET-1', locale: 'en_GB', basename: '/', currency: 'USD' }),
      },
    });
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(bodyText()).toBe('FLEET-1|USD|deps|ready|US$12.50'));
  });

  it('blocks without an operator id, or when the settings cannot be read', async () => {
    const rendered = await renderWithBilling(<Probe />, {
      bo: { getCurrentUser: async () => ({ id: null, fullName: 'Jane Doe', roles: [] }), getSettings: async () => ({ ...VALID_SETTINGS }) },
    });
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(bodyText()).toBe('FLEET-1||no-deps|prepayment.blocked.noUser|12.5'));
  });

  it('says the settings are unavailable when the back office refuses them', async () => {
    const rendered = await renderWithBilling(<Probe />, {
      bo: { getSettings: async () => Promise.reject(Object.assign(new Error('no'), { code: 'forbidden', status: 403 })) },
    });
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(bodyText()).toContain('settings.unavailable'));
  });
});

describe('guard and logOutcome', () => {
  let captured: ReturnType<typeof usePrepaymentEnv> | undefined;
  function Capture() {
    captured = usePrepaymentEnv();
    return null;
  }

  it('resolves a value, and logs an unexpected error instead of throwing', async () => {
    const rendered = await renderWithBilling(<Capture />);
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(captured).toBeDefined());
    const env = captured!;

    expect(await env.guard('charge', 'booking-1', async () => 42)).toEqual({ ok: true, value: 42 });
    expect(await env.guard('charge', 'booking-1', async () => {
      throw new RangeError('bug');
    })).toEqual({ ok: false });
    await vi.waitFor(() => expect(rendered.bo.api.log.error).toHaveBeenCalled());
    expect(rendered.bo.api.log.error).toHaveBeenCalledWith('Prepayment: charge failed unexpectedly', {
      bookingId: 'booking-1',
      error: 'RangeError: bug',
    });
  });

  it('logs the kinds and statuses of an outcome, never more', async () => {
    captured = undefined;
    const rendered = await renderWithBilling(<Capture />);
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(captured).toBeDefined());

    captured!.logOutcome('refund', 'booking-1', { kind: 'fee-charged-unrecorded', invoiceId: 'i-9', amount: 15, failure: { kind: 'rate-limited' } } as { kind: string });

    await vi.waitFor(() =>
      expect(rendered.bo.api.log.warn).toHaveBeenCalledWith('Prepayment: refund ended with fee-charged-unrecorded', {
        bookingId: 'booking-1',
        outcome: 'fee-charged-unrecorded',
        failure: { kind: 'rate-limited' },
        invoiceId: 'i-9',
      }),
    );
  });
});

describe('refresh', () => {
  let captured: ReturnType<typeof usePrepaymentEnv> | undefined;
  function Capture() {
    captured = usePrepaymentEnv();
    return null;
  }
  const stateKey = ['booking-states', 'FLEET-1', BOOKING_ID];

  it('puts a written document in the cache of the row', async () => {
    captured = undefined;
    const rendered = await renderWithBilling(<Capture />);
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(captured?.fleetId).toBe('FLEET-1'));
    const written = { id: BOOKING_ID, version: 3, expiresAt: null, value: { schemaVersion: 1, fleetId: 'FLEET-1', allocationProcessed: false } };

    await captured!.refresh(BOOKING_ID, written as never);

    expect(captured!.queryClient.getQueryData(stateKey)).toBe(written);
  });

  it('reads the document again without one: the row never fetches it by itself', async () => {
    captured = undefined;
    const rendered = await renderWithBilling(<Capture />, { stored: { internalNotes: 'kept' } });
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(captured?.fleetId).toBe('FLEET-1'));

    await captured!.refresh(BOOKING_ID, null);

    expect(captured!.queryClient.getQueryData<{ value: { internalNotes: string } }>(stateKey)?.value.internalNotes).toBe('kept');
  });

  it('logs a document it cannot read again', async () => {
    captured = undefined;
    const rendered = await renderWithBilling(<Capture />);
    rendered.bo.storage.api.get.mockRejectedValue(hostError('quota-exceeded', 507));
    unmount = rendered.view.unmount;
    await vi.waitFor(() => expect(captured?.fleetId).toBe('FLEET-1'));

    await captured!.refresh(BOOKING_ID);

    expect(rendered.bo.api.log.warn).toHaveBeenCalledWith('Prepayment: the booking state could not be read again', {
      bookingId: BOOKING_ID,
      failure: 'quota-exceeded',
    });
  });
});
