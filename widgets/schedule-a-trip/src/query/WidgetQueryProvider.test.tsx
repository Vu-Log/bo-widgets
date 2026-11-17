import { useQuery, useQueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBo } from '../test/fake-bo';
import { renderInWidget } from '../test/render';
import { persistKey } from './client';
import { queryKeys } from './keys';
import { WidgetQueryProvider } from './WidgetQueryProvider';

function Probe() {
  const client = useQueryClient();
  const models = useQuery({
    queryKey: queryKeys.models('FLEET-1'),
    queryFn: async () => ['City car'],
    gcTime: Infinity,
  });
  const customers = useQuery({
    queryKey: queryKeys.customers('FLEET-1', ['u']),
    queryFn: async () => ['Jane Doe'],
  });
  return (
    <p data-retry={String(client.getDefaultOptions().mutations?.retry)}>
      {models.data?.join()} / {customers.data?.join()}
    </p>
  );
}

let unmount: (() => void) | undefined;

beforeEach(() => localStorage.clear());
afterEach(() => {
  unmount?.();
  unmount = undefined;
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('WidgetQueryProvider', () => {
  it('gives the widget QueryClient and persists the reference data of the fleet only', async () => {
    const view = await renderInWidget(
      <WidgetQueryProvider>
        <Probe />
      </WidgetQueryProvider>,
    );
    unmount = view.unmount;

    await vi.waitFor(() => expect(view.container.textContent).toBe('City car / Jane Doe'));
    expect(view.container.querySelector('p')?.dataset.retry).toBe('0');
    await vi.waitFor(
      () => expect(localStorage.getItem(persistKey('FLEET-1'))).toContain('City car'),
      {
        timeout: 3000,
      },
    );
    expect(localStorage.getItem(persistKey('FLEET-1'))).not.toContain('Jane');
  });

  it('logs a failure of the browser storage and goes on', async () => {
    const failure = new DOMException('full', 'QuotaExceededError');
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw failure;
    });
    const { api } = fakeBo();
    const view = await renderInWidget(
      <WidgetQueryProvider>
        <Probe />
      </WidgetQueryProvider>,
      api,
    );
    unmount = view.unmount;

    await vi.waitFor(() => expect(view.container.textContent).toBe('City car / Jane Doe'));
    await vi.waitFor(
      () =>
        expect(api.log.warn).toHaveBeenCalledWith(
          'Query cache: browser storage failed',
          expect.objectContaining({ operation: 'setItem' }),
        ),
      { timeout: 3000 },
    );
  });
});
