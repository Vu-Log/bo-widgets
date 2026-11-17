import { useSyncExternalStore } from 'react';
import type { BookingContext } from '../extensions';

/** The dialog of the write feature open now. */
export type WriteDialog =
  | { readonly kind: 'create' }
  | {
      readonly kind:
        | 'edit-trip'
        | 'edit-model'
        | 'cancel'
        | 'deallocate'
        | 'remove-preallocation'
        | 'allocate'
        | 'preallocate';
      readonly ctx: BookingContext;
    };

/** The dialog open, for the actions to open one and the host to render it. */
export interface DialogStore {
  readonly get: () => WriteDialog | null;
  readonly open: (dialog: WriteDialog) => void;
  readonly close: () => void;
  readonly subscribe: (listener: () => void) => () => void;
}

/**
 * A store of the dialog open: one per section, so that an action of a row opens a dialog the host
 * of the feature renders.
 *
 * @returns The store, with no dialog open.
 */
export function createDialogStore(): DialogStore {
  let current: WriteDialog | null = null;
  const listeners = new Set<() => void>();
  const set = (next: WriteDialog | null) => {
    current = next;
    listeners.forEach((listener) => listener());
  };
  return {
    get: () => current,
    open: set,
    close: () => set(null),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * The dialog open in a store, following its changes.
 *
 * @param store - The store.
 * @returns The dialog, `null` when none.
 */
export const useOpenDialog = (store: DialogStore): WriteDialog | null =>
  useSyncExternalStore(store.subscribe, store.get, store.get);
