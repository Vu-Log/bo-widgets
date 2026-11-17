import { Component, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyText, button, click } from '../test/dom';
import { fakeBo } from '../test/fake-bo';
import { renderInWidget } from '../test/render';
import { lazyComponent } from './lazy';
import { LazyBoundary, LazyDialogBoundary } from './LazyBoundary';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  unmount = undefined;
  vi.restoreAllMocks();
});

const failing = () =>
  lazyComponent<object>('dialog', () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));

/** Catches what the boundary under test lets through. */
class Outer extends Component<{ readonly children: ReactNode }, { readonly message: string | null }> {
  override state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override render() {
    return this.state.message === null ? this.props.children : <p>outer: {this.state.message}</p>;
  }
}

function Broken(): ReactNode {
  throw new Error('a bug, not a chunk');
}

describe('LazyBoundary', () => {
  it('lets an error that is not a failed load go to the boundary above, unlogged', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bo = fakeBo();
    const view = await renderInWidget(
      <Outer>
        <LazyBoundary fallback={<span>loading</span>}>
          <Broken />
        </LazyBoundary>
      </Outer>,
      bo.api,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toBe('outer: a bug, not a chunk'));
    expect(bo.api.log.error).not.toHaveBeenCalled();
  });

  it('renders the error state it is given', async () => {
    const Lazy = failing();
    const view = await renderInWidget(
      <LazyBoundary fallback={<span>loading</span>} renderError={() => <p>static instead</p>}>
        <Lazy />
      </LazyBoundary>,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toBe('static instead'));
  });
});

describe('LazyDialogBoundary', () => {
  it('shows a dialog with a skeleton while the dialog loads', async () => {
    const Lazy = lazyComponent<object>('dialog', () => new Promise(() => undefined));
    const view = await renderInWidget(
      <LazyDialogBoundary onClose={vi.fn()}>
        <Lazy />
      </LazyDialogBoundary>,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"] [data-lazy-fallback]')).not.toBeNull());
    expect(button('Close')).toBeDefined();
  });

  it('keeps a way out when the dialog cannot be loaded: Retry and Close', async () => {
    const onClose = vi.fn();
    const Lazy = failing();
    const view = await renderInWidget(
      <LazyDialogBoundary onClose={onClose}>
        <Lazy />
      </LazyDialogBoundary>,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(bodyText()).toContain('This part of the widget could not be loaded.'));
    expect(button('Retry')).toBeDefined();

    click('Close');

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
