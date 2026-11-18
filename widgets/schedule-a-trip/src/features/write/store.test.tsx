import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInWidget } from '../../test/render';
import { context } from '../../test/section';
import { createDialogStore, useOpenDialog, type DialogStore } from './store';

describe('createDialogStore', () => {
  it('opens and closes a dialog, telling its listeners', () => {
    const store = createDialogStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(store.get()).toBeNull();
    store.open({ kind: 'create' });
    expect(store.get()).toEqual({ kind: 'create' });
    store.close();
    expect(store.get()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.open({ kind: 'create' });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('useOpenDialog', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => unmount?.());

  it('follows the dialog open', async () => {
    const store: DialogStore = createDialogStore();
    function Probe() {
      return <p>{useOpenDialog(store)?.kind ?? 'none'}</p>;
    }
    const view = await renderInWidget(<Probe />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toBe('none'));
    store.open({ kind: 'cancel', ctx: context() });
    await vi.waitFor(() => expect(view.container.textContent).toBe('cancel'));
  });
});
