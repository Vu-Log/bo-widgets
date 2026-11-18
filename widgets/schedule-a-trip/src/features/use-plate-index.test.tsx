import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../test/fake-bo';
import { renderInWidget } from '../test/render';
import { stubVulogApi } from '../test/vulog-api';
import { usePlateIndex } from './use-plate-index';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

function Probe() {
  const plateOf = usePlateIndex('FLEET-1');
  return <p>{[plateOf('vehicle-1'), plateOf('unknown'), plateOf(null)].map(String).join(' ')}</p>;
}

describe('usePlateIndex', () => {
  it('gives the plate of a vehicle of the catalogue, null otherwise', async () => {
    stubVulogApi(() => jsonResponse([{ id: 'vehicle-1', plate: 'AB-123-CD' }]));
    const view = await renderInWidget(<Probe />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toBe('AB-123-CD null null'));
  });

  it('gives null while the catalogue cannot be read', async () => {
    stubVulogApi(() => new Response('', { status: 500 }));
    const view = await renderInWidget(<Probe />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toBe('null null null'));
  });
});
