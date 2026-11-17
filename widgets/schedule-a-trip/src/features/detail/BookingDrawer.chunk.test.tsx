import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBo } from '../../test/fake-bo';
import { context, renderInSection } from '../../test/section';
import { fleetApi, stubVulogApi } from '../../test/vulog-api';
import type { BookingFeature } from '../extensions';
import { BookingDrawer } from './BookingDrawer';

// The chunk of the content of the drawer, failing on demand (`control.fail`).
const control = vi.hoisted(() => ({ fail: false }));
vi.mock('./DrawerBody', async (importOriginal) => {
  if (control.fail) throw new TypeError('Failed to fetch dynamically imported module');
  return importOriginal();
});

let unmount: (() => void) | undefined;
afterEach(() => unmount?.());

const features: BookingFeature[] = [{ id: 'f' }];

describe('BookingDrawer, when its chunk cannot be loaded', () => {
  it('shows a skeleton while its chunk loads, then an error with Retry and Close when it fails', async () => {
    control.fail = true;
    stubVulogApi(fleetApi({}));
    const onClose = vi.fn();
    const bo = fakeBo();
    const view = await renderInSection(
      <BookingDrawer bookingId="booking-1" fromList={context()} features={features} onClose={onClose} onPrevious={undefined} onNext={undefined} />,
      { api: bo.api },
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(document.body.textContent).toContain('This part of the widget could not be loaded.'));
    expect(bo.api.log.error).toHaveBeenCalledWith(
      'A part of the widget could not be loaded',
      expect.objectContaining({ chunk: 'drawer' }),
    );
    [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Close')?.click();
    expect(onClose).toHaveBeenCalledTimes(1);

    control.fail = false;
    [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Retry')?.click();

    await vi.waitFor(() => expect(document.body.textContent).toContain('Jane Doe'));
    expect(document.body.textContent).not.toContain('could not be loaded');
  });

});
