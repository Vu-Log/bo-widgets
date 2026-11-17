import { use, type ComponentType, type ReactNode } from 'react';

/** The chunk of a lazy part of the widget could not be loaded (network, CDN). */
export class ChunkLoadError extends Error {
  /** The name of the lazy part, for the logs (`drawer`, `write-dialogs`…). */
  readonly chunk: string;
  /** Forgets the failed load, so that the next render loads the chunk again (the Retry). */
  readonly forget: () => void;

  constructor(chunk: string, cause: unknown, forget: () => void = () => undefined) {
    super(`The ${chunk} part of the widget could not be loaded`, { cause });
    this.name = 'ChunkLoadError';
    this.chunk = chunk;
    this.forget = forget;
  }
}

/** A component whose code is a chunk of its own, loaded on first render or by {@link preload}. */
export interface LazyComponent<P> {
  (props: P): ReactNode;
  /**
   * Loads the chunk ahead of time (hover, idle time). Never rejects: a failed preload is forgotten,
   * and the render tries again and shows the failure.
   */
  readonly preload: () => Promise<void>;
}

/**
 * A promise with the status fields `use()` reads (the protocol React documents for a thenable that
 * is already settled), set when it settles.
 */
type Thenable<T> = Promise<T> & {
  status?: 'fulfilled' | 'rejected';
  value?: T;
  reason?: unknown;
};

/** The code of a lazy module, and the components it gives. */
export interface LazyModule<M> {
  /**
   * A component of the module, rendered once the module is loaded.
   *
   * @param pick - Picks the component: `(module) => module.TripCard`.
   * @returns The lazy component; its `preload` loads the whole module.
   */
  readonly component: <P extends object>(pick: (module: M) => ComponentType<P>) => LazyComponent<P>;
  /** Loads the module ahead of time (hover, idle time). Never rejects. */
  readonly preload: () => Promise<void>;
}

/**
 * A module loaded on demand, its components rendered like those of `React.lazy`, with two
 * differences: it can be preloaded, and a failed load is forgotten by the Retry of a `LazyBoundary`
 * (`ChunkLoadError.forget`), which runs the `import()` again. Once loaded, its components render
 * synchronously. Declare it and its components at module scope: their identity must be stable.
 *
 * @param chunk - The name of the lazy part, in the logs and in {@link ChunkLoadError}.
 * @param load - Imports the module: `() => import('./cards')`, a literal path, so that the bundler
 *   makes a chunk of it.
 * @returns The module; its components suspend while it loads and throw a {@link ChunkLoadError}
 *   when it cannot be loaded.
 */
export function lazyModule<M>(chunk: string, load: () => Promise<M>): LazyModule<M> {
  let loading: Thenable<M> | null = null;
  const forget = (promise: Promise<M>) => {
    if (loading === promise) loading = null;
  };
  const start = (): Thenable<M> => {
    if (loading) return loading;
    const promise: Thenable<M> = load().then(
      (module) => {
        // Read by `use()`: once loaded, the components render without suspending, preloaded or not.
        promise.status = 'fulfilled';
        promise.value = module;
        return module;
      },
      (cause: unknown) => {
        const error = new ChunkLoadError(chunk, cause, () => forget(promise));
        promise.status = 'rejected';
        promise.reason = error;
        // Kept until a Retry: React renders the component again to throw the error.
        throw error;
      },
    );
    loading = promise;
    return promise;
  };
  const preload = () => {
    const promise = start();
    return promise.then(
      () => undefined,
      // Forgotten at once: the render loads it again, and shows the failure if it fails again.
      () => forget(promise),
    );
  };
  const component = <P extends object>(pick: (module: M) => ComponentType<P>): LazyComponent<P> => {
    function Lazy(props: P) {
      // Always through `use()`: React refuses a component that suspended once and skips it later.
      const Component = pick(use<M>(start() as Promise<M>));
      return <Component {...props} />;
    }
    Lazy.displayName = `Lazy(${chunk})`;
    return Object.assign(Lazy, { preload });
  };
  return { component, preload };
}

/**
 * A component loaded on demand: {@link lazyModule} for a module of one component.
 *
 * @param chunk - The name of the lazy part, in the logs and in {@link ChunkLoadError}.
 * @param load - Imports the module and picks the component: `() => import('./X').then((m) => m.X)`.
 * @returns The component; it suspends while loading and throws a {@link ChunkLoadError} on failure.
 */
export const lazyComponent = <P extends object>(
  chunk: string,
  load: () => Promise<ComponentType<P>>,
): LazyComponent<P> => lazyModule(chunk, load).component((component) => component);

/**
 * Runs a task when the browser is idle (`requestIdleCallback`), or after a short delay where it
 * does not exist (Safari).
 *
 * @param task - The task.
 * @returns Cancels it.
 */
export function whenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(task, { timeout: 5_000 });
    return () => cancelIdleCallback(handle);
  }
  const timer = setTimeout(task, 1_000);
  return () => clearTimeout(timer);
}
