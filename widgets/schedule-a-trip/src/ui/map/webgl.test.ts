import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

const freshProbe = async () => (await import('./webgl')).hasWebGl;

describe('hasWebGl', () => {
  it('is true when a context can be created, which it releases at once, and probes once', async () => {
    const loseContext = vi.fn();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ getExtension: () => ({ loseContext }) } as never);
    const hasWebGl = await freshProbe();
    expect(hasWebGl()).toBe(true);
    expect(hasWebGl()).toBe(true);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it('is false without a WebGL context', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect((await freshProbe())()).toBe(false);
  });

  it('is false when the browser refuses the probe', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect((await freshProbe())()).toBe(false);
  });
});
