import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { activeObservers, installFakeIntersectionObserver } from '../test/intersection-observer';
import { renderInWidget } from '../test/render';
import { useEndReached, useVisibleRows } from './use-intersection';

let unmount: (() => void) | undefined;

beforeEach(installFakeIntersectionObserver);
afterEach(() => {
  unmount?.();
  unmount = undefined;
  vi.unstubAllGlobals();
});

function Rows({ ids, onChange }: { ids: string[]; onChange: (ids: ReadonlySet<string>) => void }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const register = useVisibleRows({ root, marginPx: 960, onChange });
  return (
    <div ref={setRoot}>
      {ids.map((id) => (
        <div key={id} data-id={id} ref={register(id)} />
      ))}
    </div>
  );
}

const rowElements = (container: HTMLElement) => [...container.querySelectorAll('[data-id]')];

describe('useVisibleRows', () => {
  it('observes every row with one observer on the scroll container, with the margin', async () => {
    const view = await renderInWidget(<Rows ids={['a', 'b', 'c']} onChange={vi.fn()} />);
    unmount = view.unmount;

    await vi.waitFor(() => expect(activeObservers()[0]?.targets.size).toBe(3));
    expect(activeObservers()).toHaveLength(1);
    expect(activeObservers()[0]?.options).toEqual({
      root: view.container.firstChild,
      rootMargin: '960px 0px',
    });
  });

  it('reports the rows that enter and leave the area', async () => {
    const onChange = vi.fn();
    const view = await renderInWidget(<Rows ids={['a', 'b', 'c']} onChange={onChange} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(activeObservers()[0]?.targets.size).toBe(3));
    const [a, b] = rowElements(view.container);
    const observer = activeObservers()[0];

    observer?.report([a!, b!], true);
    expect(onChange).toHaveBeenLastCalledWith(new Set(['a', 'b']));

    observer?.report([a!], false);
    expect(onChange).toHaveBeenLastCalledWith(new Set(['b']));
  });

  it('does not report when nothing changed', async () => {
    const onChange = vi.fn();
    const view = await renderInWidget(<Rows ids={['a']} onChange={onChange} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(activeObservers()[0]?.targets.size).toBe(1));
    const [a] = rowElements(view.container);

    activeObservers()[0]?.report([a!], false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('forgets a row once removed', async () => {
    const onChange = vi.fn();
    const view = await renderInWidget(<Rows ids={['a', 'b']} onChange={onChange} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(activeObservers()[0]?.targets.size).toBe(2));
    activeObservers()[0]?.report(rowElements(view.container), true);

    unmount();
    unmount = undefined;

    expect(onChange).toHaveBeenLastCalledWith(new Set());
    expect(activeObservers()).toHaveLength(0);
  });
});

function End({ enabled, onEndReached }: { enabled: boolean; onEndReached: () => void }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const endRef = useEndReached({ root, marginPx: 500, enabled, onEndReached });
  return (
    <div ref={setRoot}>
      <div data-end="" ref={endRef} />
    </div>
  );
}

describe('useEndReached', () => {
  it('asks for more when the end comes within the margin', async () => {
    const onEndReached = vi.fn();
    const view = await renderInWidget(<End enabled onEndReached={onEndReached} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(activeObservers()).toHaveLength(1));
    const observer = activeObservers()[0];
    expect(observer?.options.rootMargin).toBe('0px 0px 500px 0px');

    observer?.report(observer.targets, false);
    expect(onEndReached).not.toHaveBeenCalled();
    observer?.report(observer.targets, true);
    expect(onEndReached).toHaveBeenCalledTimes(1);
  });

  it('observes nothing while disabled', async () => {
    const view = await renderInWidget(<End enabled={false} onEndReached={vi.fn()} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.querySelector('[data-end]')).not.toBeNull());
    expect(activeObservers()).toHaveLength(0);
  });
});
