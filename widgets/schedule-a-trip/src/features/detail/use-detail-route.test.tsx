import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBo } from '../../test/fake-bo';
import { renderInWidget } from '../../test/render';
import { bookingIdFromPath, useDetailRoute } from './use-detail-route';

describe('bookingIdFromPath', () => {
  it('reads the first segment after the view', () => {
    expect(bookingIdFromPath('/fleet/app/widget/booking-1', '/fleet/app/widget')).toBe('booking-1');
    expect(bookingIdFromPath('/fleet/app/widget/booking%2F1/x', '/fleet/app/widget/')).toBe('booking/1');
    expect(bookingIdFromPath('/booking-1', '/')).toBe('booking-1');
  });

  it('gives null on the view itself, outside it, or for a broken segment', () => {
    expect(bookingIdFromPath('/fleet/app/widget', '/fleet/app/widget')).toBeNull();
    expect(bookingIdFromPath('/fleet/app/widget/', '/fleet/app/widget')).toBeNull();
    expect(bookingIdFromPath('/fleet/app/other/booking-1', '/fleet/app/widget')).toBeNull();
    expect(bookingIdFromPath('/fleet/app/widgetx/booking-1', '/fleet/app/widget')).toBeNull();
    expect(bookingIdFromPath('/%E0%A4%A', '/')).toBeNull();
  });
});

/** Generous: the full suite runs many files at once. */
const WAIT = { timeout: 5000 };

describe('useDetailRoute', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => {
    unmount?.();
    window.history.replaceState(null, '', '/');
  });

  function Probe() {
    const route = useDetailRoute();
    return (
      <>
        <p>{route.selectedId ?? 'none'}</p>
        <button type="button" onClick={() => route.open('booking/2')}>open</button>
        <button type="button" onClick={route.close}>close</button>
      </>
    );
  }

  const setup = async (navigate: (payload: { path: string }) => Promise<{ path: string }>) => {
    window.history.replaceState(null, '', '/booking-1');
    const navigateSpy = vi.fn(navigate);
    const bo = fakeBo({ navigate: navigateSpy });
    const view = await renderInWidget(<Probe />, bo.api);
    unmount = view.unmount;
    const click = (name: string) =>
      [...view.container.querySelectorAll('button')].find((b) => b.textContent === name)?.click();
    return { bo, navigate: navigateSpy, view, click, text: () => view.container.querySelector('p')?.textContent };
  };

  it('starts from the route, opens and closes through navigate, and follows routeChanged', async () => {
    const { bo, navigate, click, text } = await setup(async ({ path }) => ({ path }));
    await vi.waitFor(() => expect(text()).toBe('booking-1'), WAIT);

    click('open');
    await vi.waitFor(() => expect(text()).toBe('booking/2'), WAIT);
    expect(navigate).toHaveBeenLastCalledWith({ path: 'booking%2F2' });

    click('close');
    await vi.waitFor(() => expect(text()).toBe('none'), WAIT);
    expect(navigate).toHaveBeenLastCalledWith({ path: '.' });

    bo.emit('routeChanged', { pathname: '/booking-9', search: '', hash: '' });
    await vi.waitFor(() => expect(text()).toBe('booking-9'), WAIT);
  });

  it('follows the route again when the back office sends it after a refused navigation', async () => {
    const { bo, click, text } = await setup(async () =>
      Promise.reject(Object.assign(new Error('forbidden'), { code: 'forbidden' })),
    );
    await vi.waitFor(() => expect(text()).toBe('booking-1'), WAIT);
    click('open');
    await vi.waitFor(() => expect(text()).toBe('booking/2'), WAIT);

    bo.emit('routeChanged', { pathname: '/booking-1', search: '', hash: '' });

    await vi.waitFor(() => expect(text()).toBe('booking-1'), WAIT);
  });

  it('keeps the drawer and logs when the back office refuses to navigate', async () => {
    const { bo, click, text } = await setup(async () =>
      Promise.reject(Object.assign(new Error('forbidden'), { code: 'forbidden' })),
    );
    await vi.waitFor(() => expect(text()).toBe('booking-1'), WAIT);
    click('open');
    await vi.waitFor(() => expect(bo.api.log.warn).toHaveBeenCalled(), WAIT);
    expect(text()).toBe('booking/2');
  });
});
