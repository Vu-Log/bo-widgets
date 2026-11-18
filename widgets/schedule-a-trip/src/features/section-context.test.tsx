import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInWidget } from '../test/render';
import { sectionValue } from '../test/section';
import { SectionProvider, useSection } from './section-context';

let unmount: (() => void) | undefined;
afterEach(() => unmount?.());

function Probe() {
  return <p>{useSection().fleetId}</p>;
}

describe('useSection', () => {
  it('reads the value of the provider', async () => {
    const view = await renderInWidget(
      <SectionProvider value={sectionValue({ fleetId: 'FLEET-9' })}>
        <Probe />
      </SectionProvider>,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toBe('FLEET-9'));
  });

  it('throws outside a provider', () => {
    expect(() => useSection()).toThrow();
  });
});
