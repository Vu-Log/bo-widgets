import { describe, expect, it, vi } from 'vitest';
import { row } from '../../test/prepayment-fixtures';
import { createDialogStore } from './store';

describe('createDialogStore', () => {
  it('opens and closes a dialog, telling its listeners', () => {
    const store = createDialogStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const request = { action: 'charge' as const, ctx: row() };

    store.open(request);
    expect(store.getSnapshot()).toBe(request);
    store.close();
    expect(store.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.open(request);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('starts empty', () => {
    expect(createDialogStore().getSnapshot()).toBeNull();
  });
});
