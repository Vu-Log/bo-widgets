import { useSyncExternalStore } from 'react';
import type { BookingContext } from '../extensions';
import type { PrepaymentActionId } from './rules';

/** A dialog asked for by an action of a row: which action, on which booking. */
export interface DialogRequest {
  readonly action: PrepaymentActionId;
  readonly ctx: BookingContext;
}

type Listener = () => void;

/**
 * The dialog of the prepayment feature that is open. The actions of a row (`run(ctx)`) are plain
 * functions called by the list: they open a dialog here, and the `Host` of the feature, rendered
 * once at the root, shows it. The dialogs check everything again before any call.
 */
export interface DialogStore {
  readonly open: (request: DialogRequest) => void;
  readonly close: () => void;
  readonly getSnapshot: () => DialogRequest | null;
  readonly subscribe: (listener: Listener) => () => void;
}

/**
 * A new dialog store.
 *
 * @returns An empty store.
 */
export function createDialogStore(): DialogStore {
  let current: DialogRequest | null = null;
  const listeners = new Set<Listener>();
  const set = (next: DialogRequest | null) => {
    current = next;
    for (const listener of listeners) listener();
  };
  return {
    open: (request) => set(request),
    close: () => set(null),
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The dialog store of the feature, shared by its actions and its `Host`. */
export const prepaymentDialogs: DialogStore = createDialogStore();

/**
 * The dialog open in a store, following its changes.
 *
 * @param store - The store; {@link prepaymentDialogs} by default.
 * @returns The request, `null` when no dialog is open.
 */
export const useDialogRequest = (store: DialogStore = prepaymentDialogs): DialogRequest | null =>
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
