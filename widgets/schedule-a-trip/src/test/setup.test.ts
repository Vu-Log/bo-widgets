import { describe, expect, it, vi } from 'vitest';
import { WAIT_FOR_TIMEOUT } from './setup';

describe('the test setup', () => {
  it('lets vi.waitFor wait longer than the 1 s of Vitest', async () => {
    const start = Date.now();
    await vi.waitFor(() => expect(Date.now() - start).toBeGreaterThan(1200));
  });

  it('still fails once its own timeout is over', async () => {
    await expect(vi.waitFor(() => expect(false).toBe(true), { timeout: 50 })).rejects.toThrow();
  });

  it('keeps a timeout of several seconds', () => {
    expect(WAIT_FOR_TIMEOUT).toBeGreaterThanOrEqual(5000);
  });
});
