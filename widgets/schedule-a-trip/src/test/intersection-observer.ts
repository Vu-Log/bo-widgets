// Test helper: an IntersectionObserver the test drives (happy-dom never reports intersections).
import { vi } from 'vitest';

/** A fake IntersectionObserver, with the observers created so far. */
export class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly targets = new Set<Element>();
  disconnected = false;

  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {},
  ) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.disconnected = true;
    this.targets.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Reports the targets as entering (`true`) or leaving (`false`) the area. */
  report(targets: Iterable<Element>, isIntersecting: boolean) {
    const entries = [...targets].map(
      (target) => ({ target, isIntersecting }) as IntersectionObserverEntry,
    );
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

/** Installs the fake for one test: call it in `beforeEach`, `vi.unstubAllGlobals()` after. */
export function installFakeIntersectionObserver() {
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
}

/** The observers still active. */
export const activeObservers = () =>
  FakeIntersectionObserver.instances.filter((observer) => !observer.disconnected);
