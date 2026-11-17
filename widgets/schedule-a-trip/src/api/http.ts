import { BoError, type AuthFetch } from '@vulog/bo-widget-sdk';
import type { z } from 'zod';

/**
 * Why a call to the Vulog API failed.
 *
 * - `not-allowed`: 403, the role of the operator does not allow this call.
 * - `session-lost`: 401, or the back office has no token any more.
 * - `not-found`: 404.
 * - `http`: any other non-2xx status.
 * - `network`: the request did not reach the API, or its answer was lost.
 * - `aborted`: the caller aborted the request.
 * - `invalid-request`: the widget refused to send the request (its input breaks a limit of the API).
 * - `invalid-response`: the API answered 2xx with a body the widget cannot read.
 * - `back-office`: the back office refused the request (a `BoError`).
 */
export type ApiError =
  | { readonly kind: 'not-allowed'; readonly status: 403 }
  | { readonly kind: 'session-lost'; readonly status: 401 | null }
  | { readonly kind: 'not-found'; readonly status: 404 }
  | { readonly kind: 'http'; readonly status: number }
  | { readonly kind: 'network'; readonly cause: unknown }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'invalid-request'; readonly message: string }
  | { readonly kind: 'invalid-response'; readonly message: string }
  | { readonly kind: 'back-office'; readonly error: BoError };

/**
 * The outcome of a call to the Vulog API: its data, or why it failed. The API modules resolve it for
 * every failure of the API, the network or the back office; they only reject on a bug.
 */
export type ApiResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ApiError };

/** An {@link ApiError} thrown by {@link unwrap}, for a TanStack Query `queryFn`. */
export class ApiRequestError extends Error {
  readonly error: ApiError;

  constructor(error: ApiError) {
    super(apiErrorMessage(error), {
      cause:
        error.kind === 'network'
          ? error.cause
          : error.kind === 'back-office'
            ? error.error
            : undefined,
    });
    this.name = 'ApiRequestError';
    this.error = error;
  }
}

/**
 * A short message for an operator, in English. A 403 says the action is not allowed, never a
 * generic failure.
 *
 * @param error - The failure of a call.
 * @returns A readable sentence.
 */
export function apiErrorMessage(error: ApiError): string {
  switch (error.kind) {
    case 'not-allowed':
      return 'You are not allowed to do this: ask an administrator for the right role.';
    case 'session-lost':
      return 'Your session has expired: reload the back office and sign in again.';
    case 'not-found':
      return 'Not found.';
    case 'http':
      return `The Vulog API failed (HTTP ${error.status}).`;
    case 'network':
      return 'The Vulog API could not be reached.';
    case 'aborted':
      return 'The request was cancelled.';
    case 'invalid-request':
      return error.message;
    case 'invalid-response':
      return `The Vulog API answered an unexpected response: ${error.message}`;
    case 'back-office':
      return error.error.message;
  }
}

/**
 * Whether a failure must not be retried: the same request would fail the same way (a 4xx, an
 * aborted or refused request, an unreadable body).
 *
 * @param error - The failure of a call.
 * @returns `true` when retrying is pointless.
 */
export function isPermanentApiError(error: ApiError): boolean {
  switch (error.kind) {
    case 'network':
      return false;
    case 'http':
      return error.status < 500;
    case 'back-office':
      return error.error.code !== 'TIMEOUT';
    default:
      return true;
  }
}

/**
 * Gives the data of a result, or throws its error as an {@link ApiRequestError}. For a TanStack
 * Query `queryFn`, which reports a thrown error.
 *
 * @param result - The result of an API module function.
 * @returns The data of a successful result.
 * @throws {ApiRequestError} When the result is a failure.
 */
export function unwrap<T>(result: ApiResult<T>): T {
  if (result.ok) return result.data;
  throw new ApiRequestError(result.error);
}

const statusError = (status: number): ApiError => {
  if (status === 401) return { kind: 'session-lost', status };
  if (status === 403) return { kind: 'not-allowed', status };
  if (status === 404) return { kind: 'not-found', status };
  return { kind: 'http', status };
};

const rejectionError = (error: unknown, signal: AbortSignal | null | undefined): ApiError => {
  // Aborted by the caller, whatever the reason it gave (`abort(reason)`, `AbortSignal.timeout`).
  if (signal?.aborted) return { kind: 'aborted' };
  if (error instanceof DOMException && error.name === 'AbortError') return { kind: 'aborted' };
  if (error instanceof BoError) {
    if (error.code === 'INTERNAL' && error.reason === 'no-token') {
      return { kind: 'session-lost', status: null };
    }
    return { kind: 'back-office', error };
  }
  if (error instanceof TypeError) return { kind: 'network', cause: error };
  throw error;
};

/** A successful JSON answer, with its headers (pagination totals…). */
export interface JsonResponse<T> {
  readonly body: T;
  readonly headers: Headers;
}

/**
 * Calls the Vulog API with `authFetch` and reads its JSON answer with a zod schema.
 *
 * @param authFetch - `useAuthFetch()` of `@vulog/bo-widget-react`, or `bo.authFetch`.
 * @param path - A path relative to the back office admin API (`user/...`), never `boapi/proxy/...`.
 * @param schema - The schema of the body; extra fields are dropped by the schema.
 * @param init - `fetch` options (method, body, `signal`…).
 * @returns The parsed body and the headers, or why the call failed.
 * @throws What `authFetch` rejects with when it is neither a `BoError`, a `TypeError` nor an
 *   `AbortError`: a bug, not a failure of the API.
 */
export async function requestJson<S extends z.ZodType>(
  authFetch: AuthFetch,
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<ApiResult<JsonResponse<z.output<S>>>> {
  let response: Response;
  try {
    response = await authFetch(path, init);
  } catch (error) {
    return { ok: false, error: rejectionError(error, init?.signal) };
  }
  if (!response.ok) return { ok: false, error: statusError(response.status) };

  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { ok: false, error: { kind: 'invalid-response', message: 'not JSON' } };
    }
    return { ok: false, error: rejectionError(error, init?.signal) };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: { kind: 'invalid-response', message: parsed.error.message } };
  }
  return { ok: true, data: { body: parsed.data, headers: response.headers } };
}

/**
 * Encodes one segment of a path (an id), so that it cannot change the route.
 *
 * @param value - An id from the API or the storage.
 * @returns The value, URI-encoded.
 */
export const segment = (value: string | number): string => encodeURIComponent(String(value));
