import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBo } from '../../test/fake-bo';
import { booking, context, renderInSection } from '../../test/section';
import { fleetApi, stubVulogApi } from '../../test/vulog-api';
import type { BookingFeature } from '../extensions';
import { BookingDrawer, type BookingDrawerProps } from './BookingDrawer';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

const run = vi.fn();
const features: BookingFeature[] = [
  {
    id: 'f',
    primaryAction: () => ({ id: 'go', label: 'Go', run }),
    detailCards: [
      { id: 'late', order: 50, render: () => <section aria-label="Late">late</section> },
      { id: 'early', order: 5, render: (ctx) => <section aria-label="Early">{ctx.booking.id}</section> },
    ],
  },
];

async function render(props: Partial<BookingDrawerProps> = {}, now?: Date) {
  stubVulogApi(fleetApi({}));
  const view = await renderInSection(
    <BookingDrawer
      bookingId="booking-1"
      fromList={context()}
      features={features}
      onClose={vi.fn()}
      onPrevious={undefined}
      onNext={undefined}
      {...props}
    />,
    { api: fakeBo().api, value: now ? { now } : {} },
  );
  unmount = view.unmount;
  const drawer = () => document.body.querySelector<HTMLElement>('[role="dialog"][aria-label="Booking details"]');
  const button = (name: string) =>
    [...(drawer()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (b) => b.textContent === name || b.getAttribute('aria-label') === name,
    );
  await vi.waitFor(() => expect(drawer()).not.toBeNull());
  return { drawer, button };
}

describe('BookingDrawer', () => {
  it('shows the header, the primary action and the cards of the features by order', async () => {
    const { drawer, button } = await render();
    await vi.waitFor(() => expect(drawer()?.textContent).toContain('Jane Doe'));
    expect([...drawer()!.querySelectorAll('section[aria-label]')].map((s) => s.getAttribute('aria-label'))).toEqual(['Early', 'Late']);
    button('Go')?.click();
    expect(run).toHaveBeenCalled();
    expect(button('Previous booking')?.disabled).toBe(true);
  });

  it('moves with the arrows and the buttons, and closes', async () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onClose = vi.fn();
    const { drawer, button } = await render({ onPrevious, onNext, onClose });
    drawer()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    drawer()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    button('Next booking')?.click();
    button('Close')?.click();
    expect(onNext).toHaveBeenCalledTimes(2);
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('marks the data of an old booking without document as archived, read only', async () => {
    const { drawer, button } = await render(
      { fromList: context({ booking: booking({ startDate: '2024-01-01T10:00:00Z', plannedReturnDate: null }) }) },
      new Date('2026-03-10T08:00:00Z'),
    );
    await vi.waitFor(() => expect(drawer()?.textContent).toContain('Archived data'));
    expect(button('Go')).toBeUndefined();
  });

  it('shows the failure of a deep link, with a way out', async () => {
    const onClose = vi.fn();
    stubVulogApi(fleetApi({}));
    const view = await renderInSection(
      <BookingDrawer bookingId="unknown" fromList={undefined} features={features} onClose={onClose} onPrevious={undefined} onNext={undefined} />,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('Not found.'));
    [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Close')?.click();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows nothing without a booking', async () => {
    stubVulogApi(fleetApi({}));
    const view = await renderInSection(
      <BookingDrawer bookingId={null} fromList={undefined} features={features} onClose={vi.fn()} onPrevious={undefined} onNext={undefined} />,
    );
    unmount = view.unmount;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows a dash instead of a skeleton for a booking without customer', async () => {
    const { drawer } = await render({ fromList: context({ booking: booking({ userId: null }), customer: undefined }) });
    await vi.waitFor(() => expect(drawer()?.querySelector('h2')?.textContent).toBe('–'));
  });

  it('warns when the stored state cannot be read, with a retry', async () => {
    stubVulogApi(fleetApi({}));
    const bo = fakeBo();
    bo.storage.api.get.mockRejectedValueOnce(Object.assign(new Error('rate'), { code: 'rate-limited', status: 429 }));
    const view = await renderInSection(
      <BookingDrawer bookingId="booking-1" fromList={context({ state: undefined })} features={features} onClose={vi.fn()} onPrevious={undefined} onNext={undefined} />,
      { api: bo.api },
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(document.body.textContent).toContain('could not be read'));
    [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Retry')?.click();
    await vi.waitFor(() => expect(document.body.textContent).not.toContain('could not be read'));
  });
});
