import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../../i18n';
import { queryKeys } from '../../query/keys';
import { fakeBo, jsonResponse } from '../../test/fake-bo';
import { renderInSection, stateDoc } from '../../test/section';
import { stubVulogApi } from '../../test/vulog-api';
import type { WriteDeps } from './operations';
import { describeOutcome, failureText, useAfterWrite, useReportFailure, useWriteDeps, warningText } from './use-write';

const { t } = createI18n('en_GB');

describe('failureText', () => {
  it('says each failure in words', () => {
    expect(failureText({ kind: 'api', error: { kind: 'not-allowed', status: 403 } }, t)).toContain('not allowed');
    expect(failureText({ kind: 'storage', error: { kind: 'conflict' } }, t)).toBe('Someone changed this booking meanwhile: try again.');
    expect(failureText({ kind: 'storage', error: { kind: 'quota-exceeded' } }, t)).toBe('The data of the widget could not be written (quota-exceeded).');
    expect(failureText({ kind: 'already-processed' }, t)).toContain('already handled');
    expect(
      failureText({ kind: 'rollback-failed', vehicleId: 'v-1', error: { kind: 'http', status: 500 }, cause: { kind: 'conflict' } }, t),
    ).toContain('v-1');
    expect(failureText({ kind: 'vehicle-unavailable', vehicleId: 'v-1' }, t)).toContain('no longer available');
    expect(failureText({ kind: 'allocation-unknown', vehicleId: 'v-1' }, t)).toContain('may have been done');
  });
});

describe('warningText', () => {
  it('says each warning in words', () => {
    expect(warningText({ kind: 'vehicle-not-enabled', vehicleId: 'v-1' }, t)).toContain('v-1 could not be put back');
    expect(warningText({ kind: 'vehicle-held-elsewhere', vehicleId: 'v-1' }, t)).toContain('another reason');
    expect(warningText({ kind: 'state-not-updated', error: { kind: 'conflict' } }, t)).toContain('could not be updated');
    expect(warningText({ kind: 'vehicle-not-checked', vehicleId: 'v-1' }, t)).toContain('could not be read');
  });
});

describe('useWriteDeps and useAfterWrite', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => {
    unmount?.();
    vi.restoreAllMocks();
  });

  it('read the reason of a vehicle again, and update the caches and tell the operator after a write', async () => {
    stubVulogApi(({ path }) =>
      path === 'fleetmanager/public/fleets/FLEET-1/vehicles' ? jsonResponse([{ id: 'v-1', outOfServiceReason: 'Repair' }]) : undefined,
    );
    const bo = fakeBo();
    let deps: WriteDeps | undefined;
    let after: ReturnType<typeof useAfterWrite> | undefined;
    function Probe() {
      deps = useWriteDeps();
      after = useAfterWrite();
      return null;
    }
    const view = await renderInSection(<Probe />, { api: bo.api });
    unmount = view.unmount;
    await vi.waitFor(() => expect(deps).toBeDefined());
    expect(deps?.fleetId).toBe('FLEET-1');
    expect(deps?.userId).toBe('user-1');
    expect(await deps?.reasonOf('v-1')).toEqual({ ok: true, data: { found: true, reason: 'Repair' } });
    expect(await deps?.reasonOf('v-2')).toEqual({ ok: true, data: { found: false } });

    const invalidate = vi.spyOn(view.queryClient, 'invalidateQueries');
    after?.('Done.', 'booking-1', stateDoc({ preallocatedVehicleId: 'v-1' }), [{ kind: 'vehicle-not-enabled', vehicleId: 'v-0' }], t);
    expect(view.queryClient.getQueryData(queryKeys.bookingState('FLEET-1', 'booking-1'))).toMatchObject({ version: 1 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.fleetBookings('FLEET-1') });
    await vi.waitFor(() => expect(bo.api.notify).toHaveBeenCalledTimes(2));
    expect(bo.api.notify).toHaveBeenNthCalledWith(1, { message: 'Done.', severity: 'success' });
    expect(bo.api.notify).toHaveBeenNthCalledWith(2, expect.objectContaining({ severity: 'warning' }));
    expect(bo.api.log.warn).toHaveBeenCalledWith('A write left something to check', {
      bookingId: 'booking-1',
      kind: 'vehicle-not-enabled',
      vehicleId: 'v-0',
    });
  });

  it('gives the failure when the fleet manager fails', async () => {
    stubVulogApi(() => new Response('', { status: 500 }));
    let deps: WriteDeps | undefined;
    function Probe() {
      deps = useWriteDeps();
      return null;
    }
    const view = await renderInSection(<Probe />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(deps).toBeDefined());
    expect(await deps?.reasonOf('v-1')).toEqual({ ok: false, error: { kind: 'http', status: 500 } });
  });
});

describe('describeOutcome and useReportFailure', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => unmount?.());

  it('logs a failure that leaves something to check as an error, another as a warning', async () => {
    const bo = fakeBo();
    let report: ReturnType<typeof useReportFailure> | undefined;
    function Probe() {
      report = useReportFailure();
      return null;
    }
    const view = await renderInSection(<Probe />, { api: bo.api });
    unmount = view.unmount;
    await vi.waitFor(() => expect(report).toBeDefined());
    report?.({ kind: 'rollback-failed', vehicleId: 'v-1', error: { kind: 'http', status: 500 }, cause: { kind: 'conflict' } }, 'booking-1');
    report?.({ kind: 'already-processed' }, 'booking-1');
    expect(bo.api.log.error).toHaveBeenCalledWith('A write failed', {
      bookingId: 'booking-1',
      kind: 'rollback-failed',
      vehicleId: 'v-1',
      error: 'http',
      cause: 'conflict',
    });
    expect(bo.api.log.warn).toHaveBeenCalledWith('A write failed', { bookingId: 'booking-1', kind: 'already-processed' });
    expect(describeOutcome({ kind: 'vehicle-unavailable', vehicleId: 'v' })).toEqual({ kind: 'vehicle-unavailable', vehicleId: 'v' });
  });
});
