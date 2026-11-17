import { useCallback, useEffect, useRef, useState } from 'react';

/** Options of {@link useVisibleRows}. */
export interface VisibleRowsOptions {
  /** The scroll container the rows are in; nothing is observed while `null`. */
  readonly root: Element | null;
  /** Margin around the visible area, in px, inside which a row counts as visible. */
  readonly marginPx: number;
  /** Called with the ids of the rows in view (plus the margin) each time they change. */
  readonly onChange: (ids: ReadonlySet<string>) => void;
}

/** Gives the ref callback of the row of an id. */
export type RegisterRow = (id: string) => (element: Element | null) => void;

/**
 * Follows which rows are on screen, plus a margin, with one `IntersectionObserver` on the scroll
 * container: `content-visibility` skips the painting of the rows off screen, but does not tell
 * React which ones are visible. Use it to load the data of the visible rows only.
 *
 * @param options - Scroll container, margin and listener.
 * @returns `register(id)`, the ref callback of a row; stable for a given id, so that memoized rows
 *   keep their props.
 */
export function useVisibleRows({ root, marginPx, onChange }: VisibleRowsOptions): RegisterRow {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const elements = useRef(new Map<Element, string>());
  const visible = useRef(new Set<string>());
  const observer = useRef<IntersectionObserver | null>(null);
  const callbacks = useRef(new Map<string, (element: Element | null) => void>());

  useEffect(() => {
    if (root === null) return undefined;
    const current = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const id = elements.current.get(entry.target);
          if (id === undefined) continue;
          if (entry.isIntersecting && !visible.current.has(id)) {
            visible.current.add(id);
            changed = true;
          } else if (!entry.isIntersecting && visible.current.delete(id)) {
            changed = true;
          }
        }
        if (changed) onChangeRef.current(new Set(visible.current));
      },
      { root, rootMargin: `${marginPx}px 0px` },
    );
    observer.current = current;
    for (const element of elements.current.keys()) current.observe(element);
    return () => {
      current.disconnect();
      observer.current = null;
    };
  }, [root, marginPx]);

  return useCallback((id: string) => {
    const existing = callbacks.current.get(id);
    if (existing) return existing;
    let observed: Element | null = null;
    const callback = (element: Element | null) => {
      if (observed !== null) {
        observer.current?.unobserve(observed);
        elements.current.delete(observed);
        if (visible.current.delete(id)) onChangeRef.current(new Set(visible.current));
      }
      observed = element;
      if (element === null) {
        callbacks.current.delete(id);
        return;
      }
      elements.current.set(element, id);
      observer.current?.observe(element);
    };
    callbacks.current.set(id, callback);
    return callback;
  }, []);
}

/** Options of {@link useEndReached}. */
export interface EndReachedOptions {
  /** The scroll container; nothing is observed while `null`. */
  readonly root: Element | null;
  /** How far before the end, in px, the next page is asked for. */
  readonly marginPx: number;
  /** `false` while a page is loading or when there is no next page. */
  readonly enabled: boolean;
  readonly onEndReached: () => void;
}

/**
 * Calls `onEndReached` when the end of a list comes within `marginPx` of the visible area: put the
 * returned ref on an element after the last row. Observing again each time `enabled` turns back on
 * asks for one more page when the end is still in view after a page loaded.
 *
 * @param options - Scroll container, margin, whether to load, and the loader.
 * @returns The ref callback of the element that marks the end of the list.
 */
export function useEndReached({ root, marginPx, enabled, onEndReached }: EndReachedOptions) {
  const onEndReachedRef = useRef(onEndReached);
  onEndReachedRef.current = onEndReached;
  const [sentinel, setSentinel] = useState<Element | null>(null);

  useEffect(() => {
    if (!enabled || root === null || sentinel === null) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onEndReachedRef.current();
      },
      { root, rootMargin: `0px 0px ${marginPx}px 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled, root, sentinel, marginPx]);

  return setSentinel;
}
