import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBo } from '../test/fake-bo';
import { renderInWidget } from '../test/render';
import { ChunkLoadError, lazyComponent, whenIdle } from './lazy';
import { LazyBoundary } from './LazyBoundary';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  unmount = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A loader the test settles by hand. */
function deferredLoader() {
  const calls: { resolve: () => void; reject: (error: Error) => void }[] = [];
  const Hello = ({ name }: { readonly name: string }) => <p>Hello {name}</p>;
  const load = vi.fn(
    () =>
      new Promise<typeof Hello>((resolve, reject) => {
        calls.push({ resolve: () => resolve(Hello), reject });
      }),
  );
  return { load, calls };
}

describe('lazyComponent', () => {
  it('suspends while its chunk loads, then renders it', async () => {
    const { load, calls } = deferredLoader();
    const Lazy = lazyComponent('hello', load);
    const view = await renderInWidget(
      <LazyBoundary fallback={<span>loading</span>}>
        <Lazy name="Jane" />
      </LazyBoundary>,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toBe('loading'));

    calls[0]?.resolve();

    await vi.waitFor(() => expect(view.container.textContent).toBe('Hello Jane'));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('preloads once, and renders at once when preloaded', async () => {
    const { load, calls } = deferredLoader();
    const Lazy = lazyComponent('hello', load);
    const first = Lazy.preload();
    const second = Lazy.preload();
    calls[0]?.resolve();
    await Promise.all([first, second]);
    expect(load).toHaveBeenCalledTimes(1);

    const fallback = vi.fn(() => <span>loading</span>);
    function Fallback() {
      return fallback();
    }
    const view = await renderInWidget(
      <LazyBoundary fallback={<Fallback />}>
        <Lazy name="Jane" />
      </LazyBoundary>,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toBe('Hello Jane'));
    // Preloaded: no skeleton, not even for a render.
    expect(fallback).not.toHaveBeenCalled();
  });

  it('never rejects a preload, and forgets its failure: the next load tries again', async () => {
    const { load, calls } = deferredLoader();
    const Lazy = lazyComponent('hello', load);
    const preload = Lazy.preload();
    calls[0]?.reject(new Error('offline'));
    await expect(preload).resolves.toBeUndefined();

    const again = Lazy.preload();
    calls[1]?.resolve();
    await again;
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('throws a ChunkLoadError to the boundary, whose Retry loads the chunk again', async () => {
    const { load, calls } = deferredLoader();
    const Lazy = lazyComponent('hello', load);
    const bo = fakeBo();
    const view = await renderInWidget(
      <LazyBoundary fallback={<span>loading</span>}>
        <Lazy name="Jane" />
      </LazyBoundary>,
      bo.api,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const offline = new TypeError('Failed to fetch dynamically imported module');

    calls[0]?.reject(offline);

    await vi.waitFor(() =>
      expect(view.container.textContent).toContain('This part of the widget could not be loaded.'),
    );
    expect(bo.api.log.error).toHaveBeenCalledWith('A part of the widget could not be loaded', {
      chunk: 'hello',
      name: 'TypeError',
      message: 'Failed to fetch dynamically imported module',
    });

    view.container.querySelector('button')?.click();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    calls[1]?.resolve();
    await vi.waitFor(() => expect(view.container.textContent).toBe('Hello Jane'));
  });
});

describe('ChunkLoadError', () => {
  it('names the chunk and keeps the browser error', () => {
    const cause = new Error('offline');
    const error = new ChunkLoadError('drawer', cause);
    expect(error).toMatchObject({ name: 'ChunkLoadError', chunk: 'drawer', cause });
    expect(error.message).toBe('The drawer part of the widget could not be loaded');
  });
});

describe('whenIdle', () => {
  it('waits for the browser to be idle, and can be cancelled', () => {
    const request = vi.fn(() => 7);
    const cancel = vi.fn();
    vi.stubGlobal('requestIdleCallback', request);
    vi.stubGlobal('cancelIdleCallback', cancel);
    const task = vi.fn();

    const stop = whenIdle(task);
    expect(request).toHaveBeenCalledWith(task, { timeout: 5_000 });
    stop();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it('falls back to a timer without requestIdleCallback (Safari)', () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.useFakeTimers();
    const task = vi.fn();

    whenIdle(task);
    vi.advanceTimersByTime(999);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(1);

    const cancelled = vi.fn();
    whenIdle(cancelled)();
    vi.advanceTimersByTime(2_000);
    expect(cancelled).not.toHaveBeenCalled();
  });
});
