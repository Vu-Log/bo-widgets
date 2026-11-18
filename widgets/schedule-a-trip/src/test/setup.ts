import { vi } from 'vitest';

/**
 * Default timeout of `vi.waitFor` in every test file, instead of Vitest's 1 s. On a loaded runner (the CI), the first
 * render of a lazy chunk or a fake back office round trip can take more than a second, and the tests then failed at
 * random. Vitest has no option for it, so `vi.waitFor` is wrapped here; a timeout given by a test still wins.
 */
export const WAIT_FOR_TIMEOUT = 5000;

const waitFor = vi.waitFor;
vi.waitFor = ((callback, options) =>
  waitFor(
    callback,
    typeof options === 'number' ? options : { ...options, timeout: options?.timeout ?? WAIT_FOR_TIMEOUT },
  )) as typeof vi.waitFor;
