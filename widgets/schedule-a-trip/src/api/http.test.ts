import { BoError, type AuthFetch } from '@vulog/bo-widget-sdk';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { jsonResponse } from '../test/fake-bo';
import {
  apiErrorMessage,
  ApiRequestError,
  isPermanentApiError,
  requestJson,
  segment,
  unwrap,
  type ApiError,
} from './http';

const schema = z.object({ id: z.string() });
const fetchWith = (implementation: () => Promise<Response>) => vi.fn<AuthFetch>(implementation);

describe('requestJson', () => {
  it('gives the parsed body and the headers', async () => {
    const authFetch = fetchWith(async () =>
      jsonResponse({ id: 'a', extra: 1 }, { headers: { totalpages: '3' } }),
    );

    const result = await requestJson(authFetch, 'user/things', schema, { method: 'GET' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.body).toEqual({ id: 'a' });
    expect(result.data.headers.get('totalpages')).toBe('3');
    expect(authFetch).toHaveBeenCalledWith('user/things', { method: 'GET' });
  });

  it.each([
    [401, { kind: 'session-lost', status: 401 }],
    [403, { kind: 'not-allowed', status: 403 }],
    [404, { kind: 'not-found', status: 404 }],
    [409, { kind: 'http', status: 409 }],
    [500, { kind: 'http', status: 500 }],
  ])('maps the status %s', async (status, error) => {
    const result = await requestJson(
      fetchWith(async () => new Response('', { status })),
      'x',
      schema,
    );
    expect(result).toEqual({ ok: false, error });
  });

  it('reports a body that is not JSON', async () => {
    const result = await requestJson(
      fetchWith(async () => new Response('<html>')),
      'x',
      schema,
    );
    expect(result).toEqual({ ok: false, error: { kind: 'invalid-response', message: 'not JSON' } });
  });

  it('reports a body that does not match the schema', async () => {
    const result = await requestJson(
      fetchWith(async () => jsonResponse({ id: 42 })),
      'x',
      schema,
    );
    expect(result.ok === false && result.error.kind).toBe('invalid-response');
  });

  it('maps a network failure', async () => {
    const cause = new TypeError('Failed to fetch');
    const result = await requestJson(
      fetchWith(() => Promise.reject(cause)),
      'x',
      schema,
    );
    expect(result).toEqual({ ok: false, error: { kind: 'network', cause } });
  });

  it('maps an abort', async () => {
    const result = await requestJson(
      fetchWith(() => Promise.reject(new DOMException('aborted', 'AbortError'))),
      'x',
      schema,
    );
    expect(result).toEqual({ ok: false, error: { kind: 'aborted' } });
  });

  it('maps an abort with a reason of the caller', async () => {
    const controller = new AbortController();
    controller.abort(new Error('closed'));
    const result = await requestJson(
      fetchWith(() => Promise.reject(controller.signal.reason)),
      'x',
      schema,
      { signal: controller.signal },
    );
    expect(result).toEqual({ ok: false, error: { kind: 'aborted' } });
  });

  it('maps a lost token of the back office to session-lost', async () => {
    const error = new BoError('INTERNAL', 'no token', { reason: 'no-token' });
    const result = await requestJson(
      fetchWith(() => Promise.reject(error)),
      'x',
      schema,
    );
    expect(result).toEqual({ ok: false, error: { kind: 'session-lost', status: null } });
  });

  it('keeps another refusal of the back office', async () => {
    const error = new BoError('FORBIDDEN', 'apiInfo missing');
    const result = await requestJson(
      fetchWith(() => Promise.reject(error)),
      'x',
      schema,
    );
    expect(result).toEqual({ ok: false, error: { kind: 'back-office', error } });
  });

  it('rethrows what is not a failure of the call', async () => {
    const bug = new RangeError('bug');
    await expect(
      requestJson(
        fetchWith(() => Promise.reject(bug)),
        'x',
        schema,
      ),
    ).rejects.toBe(bug);
  });

  it('maps a body cut by the network', async () => {
    const response = jsonResponse({ id: 'a' });
    vi.spyOn(response, 'json').mockRejectedValue(new TypeError('network error'));
    const result = await requestJson(
      fetchWith(async () => response),
      'x',
      schema,
    );
    expect(result.ok === false && result.error.kind).toBe('network');
  });
});

describe('apiErrorMessage', () => {
  it('says a 403 is not allowed', () => {
    expect(apiErrorMessage({ kind: 'not-allowed', status: 403 })).toMatch(/not allowed/);
  });

  it.each<ApiError>([
    { kind: 'session-lost', status: 401 },
    { kind: 'not-found', status: 404 },
    { kind: 'http', status: 502 },
    { kind: 'network', cause: null },
    { kind: 'aborted' },
    { kind: 'invalid-request', message: 'Too many ids' },
    { kind: 'invalid-response', message: 'not JSON' },
    { kind: 'back-office', error: new BoError('TIMEOUT', 'no answer') },
  ])('gives a sentence for $kind', (error) => {
    expect(apiErrorMessage(error).length).toBeGreaterThan(3);
  });

  it('includes the status of an HTTP failure', () => {
    expect(apiErrorMessage({ kind: 'http', status: 502 })).toContain('502');
  });
});

describe('isPermanentApiError', () => {
  it('lets a network failure, a 5xx and a timeout be retried', () => {
    expect(isPermanentApiError({ kind: 'network', cause: null })).toBe(false);
    expect(isPermanentApiError({ kind: 'http', status: 503 })).toBe(false);
    expect(
      isPermanentApiError({ kind: 'back-office', error: new BoError('TIMEOUT', 'slow') }),
    ).toBe(false);
  });

  it('never retries a 4xx, an abort or a refused request', () => {
    expect(isPermanentApiError({ kind: 'not-allowed', status: 403 })).toBe(true);
    expect(isPermanentApiError({ kind: 'http', status: 409 })).toBe(true);
    expect(isPermanentApiError({ kind: 'aborted' })).toBe(true);
    expect(
      isPermanentApiError({ kind: 'back-office', error: new BoError('FORBIDDEN', 'no') }),
    ).toBe(true);
  });
});

describe('unwrap', () => {
  it('gives the data of a success', () => {
    expect(unwrap({ ok: true, data: 1 })).toBe(1);
  });

  it('throws the failure as an ApiRequestError', () => {
    const error: ApiError = { kind: 'not-allowed', status: 403 };
    expect(() => unwrap({ ok: false, error })).toThrow(ApiRequestError);
    try {
      unwrap({ ok: false, error });
    } catch (thrown) {
      expect((thrown as ApiRequestError).error).toBe(error);
      expect((thrown as ApiRequestError).message).toMatch(/not allowed/);
    }
  });
});

describe('ApiRequestError', () => {
  it('keeps the original error as the cause', () => {
    const cause = new TypeError('Failed to fetch');
    expect(new ApiRequestError({ kind: 'network', cause }).cause).toBe(cause);
    const boError = new BoError('TIMEOUT', 'slow');
    expect(new ApiRequestError({ kind: 'back-office', error: boError }).cause).toBe(boError);
    expect(new ApiRequestError({ kind: 'aborted' }).cause).toBeUndefined();
  });
});

describe('segment', () => {
  it('encodes an id so that it cannot change the route', () => {
    expect(segment('a/../b?c')).toBe('a%2F..%2Fb%3Fc');
    expect(segment(42)).toBe('42');
  });
});
