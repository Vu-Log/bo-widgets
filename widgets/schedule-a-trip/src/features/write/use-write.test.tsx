import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../../i18n';
import { queryKeys } from '../../query/keys';
import { fakeBo, jsonResponse } from '../../test/fake-bo';
import { renderInSection, stateDoc } from '../../test/section';
import { stubVulogApi } from '../../test/vulog-api';
import type { WriteDeps } from './operations';
import { failureText, useAfterWrite, useWriteDeps, warningText } from './use-write';

const { t } = createI18n('en_GB');

describe('failureText', () => {
  it('says each failure in words', () => {
    expect(failureText({ kind: 'api', error: { kind: 'not-allowed', status: 403 } }, t)).toContain('not allowed');
    expect(failureText({ kind: 'storage', error: { kind: 'conflict' } }, t)).toBe('Someone changed this booking meanwhile: try again.');
    expect(failureText({ kind: 'storage', error: { kind: 'quota-exceeded' } }, t)).toBe('The data of the widget could not be written (quota-exceeded).');
    expect(failureText({ kind: 'already-processed' }, t)).toContain('already handled');
    expect(failureText({ kind: 'rollback-failed', vehicleId: 'v-1', error: { kind: 'http', status: 500 } }, t)).toContain('v-1');
  });
});

describe('warningText', () => {
  it('says each warning in words', () => {
    expect(warningText({ kind: 'vehicle-not-enabled', vehicleId: 'v-1' }, t)).toContain('v-1 could not be put back');
    expect(warningText({ kind: 'vehicle-held-elsewhere', vehicleId: 'v-1' }, t)).toContain('another reason');
    expect(warningText({ kind: 'state-not-updated', error: { kind: 'conflict' } }, t)).toContain('could not be updated');
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
    expect(await deps?.reasonOf('v-1')).toBe('Repair');
    expect(await deps?.reasonOf('v-2')).toBeNull();

    const invalidate = vi.spyOn(view.queryClient, 'invalidateQueries');
    after?.('Done.', 'booking-1', stateDoc({ preallocatedVehicleId: 'v-1' }), [{ kind: 'vehicle-not-enabled', vehicleId: 'v-0' }], t);
    expect(view.queryClient.getQueryData(queryKeys.bookingState('FLEET-1', 'booking-1'))).toMatchObject({ version: 1 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.fleetBookings('FLEET-1') });
    await vi.waitFor(() => expect(bo.api.notify).toHaveBeenCalledTimes(2));
    expect(bo.api.notify).toHaveBeenNthCalledWith(1, { message: 'Done.', severity: 'success' });
    expect(bo.api.notify).toHaveBeenNthCalledWith(2, expect.objectContaining({ severity: 'warning' }));
    expect(bo.api.log.warn).toHaveBeenCalledWith('A write left something to check', { warning: 'vehicle-not-enabled', bookingId: 'booking-1' });
  });

  it('fails to read a reason when the fleet manager fails', async () => {
    stubVulogApi(() => new Response('', { status: 500 }));
    let deps: WriteDeps | undefined;
    function Probe() {
      deps = useWriteDeps();
      return null;
    }
    const view = await renderInSection(<Probe />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(deps).toBeDefined());
    await expect(deps?.reasonOf('v-1')).rejects.toThrow();
  });
});
