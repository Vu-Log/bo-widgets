// Test helpers: a fake of the API the back office injects into the element (`vulogBo`), with an
// in-memory storage that answers like the BO (versions, `ifVersion`, `ttlSeconds`, pages).
import { vi } from 'vitest';

type Listener = (data: unknown) => void;

/** Base URL of the Vulog API in the tests. */
export const API_BASE_URL = 'https://api.example.com/boapi/proxy/';

/** Settings of a complete installation, with neutral values. */
export const VALID_SETTINGS = {
  prepaymentProductId: '11111111-1111-4111-8111-111111111111',
  cancellationFeesProductId: '22222222-2222-4222-8222-222222222222',
  dayRate: 100,
  ratio: 1,
  minimumAmount: 10,
  refundFullHours: 24,
  creditsRevokeHours: 1,
  vehicleSearchRadius: 500,
  mapboxToken: 'pk.placeholder',
};

/** An error as the BO API throws it: its `code` becomes the `reason` of a `BoError`. */
export const hostError = (code: string, status: number | null) =>
  Object.assign(new Error(`storage: ${code}`), { code, status });

interface StoredDoc {
  id: string;
  value: Record<string, unknown>;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  expiresAt?: string;
}

interface WriteOptions {
  ifVersion?: number;
  ttlSeconds?: number | null;
}

/** A storage space in memory, with the checks of the BO that the widget relies on. */
export function createFakeStorage(now: () => Date = () => new Date('2026-01-01T00:00:00.000Z')) {
  const collections = new Map<string, Map<string, StoredDoc>>();
  const docsOf = (name: string) => {
    const existing = collections.get(name);
    if (existing) return existing;
    const created = new Map<string, StoredDoc>();
    collections.set(name, created);
    return created;
  };
  const expiry = (ttlSeconds: number | null | undefined, previous: string | undefined) => {
    if (ttlSeconds === undefined) return previous;
    if (ttlSeconds === null) return undefined;
    return new Date(now().getTime() + ttlSeconds * 1000).toISOString();
  };
  const checkVersion = (existing: StoredDoc | undefined, ifVersion: number | undefined) => {
    if (ifVersion === undefined) return;
    if (ifVersion === 0 && existing) throw hostError('already-exists', 409);
    if (ifVersion !== 0 && existing?.version !== ifVersion) {
      throw existing ? hostError('version-conflict', 409) : hostError('not-found', 404);
    }
  };
  const write = (
    name: string,
    id: string,
    value: Record<string, unknown>,
    expiresAt: string | undefined,
  ) => {
    const docs = docsOf(name);
    const existing = docs.get(id);
    const at = now().toISOString();
    const doc: StoredDoc = {
      id,
      value: JSON.parse(JSON.stringify(value)) as Record<string, unknown>,
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? at,
      createdBy: existing?.createdBy ?? 'user-1',
      updatedAt: at,
      updatedBy: 'user-1',
      ...(expiresAt === undefined ? {} : { expiresAt }),
    };
    docs.set(id, doc);
    return structuredClone(doc);
  };
  const page = (items: StoredDoc[], options: { limit?: number; cursor?: string } = {}) => {
    const limit = options.limit ?? 50;
    const offset = options.cursor === undefined ? 0 : Number(options.cursor);
    const end = offset + limit;
    return {
      items: items.slice(offset, end).map((doc) => structuredClone(doc)),
      nextCursor: end < items.length ? String(end) : null,
    };
  };
  const sorted = (name: string) =>
    [...docsOf(name).values()].sort((a, b) => a.id.localeCompare(b.id));

  const api = {
    get: vi.fn(async (name: string, id: string) => {
      const doc = docsOf(name).get(id);
      if (!doc) throw hostError('not-found', 404);
      return structuredClone(doc);
    }),
    set: vi.fn(
      async (
        name: string,
        id: string,
        value: Record<string, unknown>,
        options: WriteOptions = {},
      ) => {
        const existing = docsOf(name).get(id);
        checkVersion(existing, options.ifVersion);
        return write(name, id, value, expiry(options.ttlSeconds, undefined));
      },
    ),
    update: vi.fn(
      async (
        name: string,
        id: string,
        patch: Record<string, unknown>,
        options: WriteOptions = {},
      ) => {
        const existing = docsOf(name).get(id);
        if (!existing) throw hostError('not-found', 404);
        checkVersion(existing, options.ifVersion);
        return write(
          name,
          id,
          { ...existing.value, ...patch },
          expiry(options.ttlSeconds, existing.expiresAt),
        );
      },
    ),
    delete: vi.fn(async (name: string, id: string) => {
      docsOf(name).delete(id);
      return null;
    }),
    list: vi.fn(async (name: string, options?: { limit?: number; cursor?: string }) =>
      page(sorted(name), options),
    ),
    query: vi.fn(
      async (
        name: string,
        options: { where: Record<string, unknown>; limit?: number; cursor?: string },
      ) =>
        page(
          sorted(name).filter((doc) =>
            Object.entries(options.where).every(([key, value]) => doc.value[key] === value),
          ),
          options,
        ),
    ),
    clear: vi.fn(async (name: string) => {
      const deletedDocs = docsOf(name).size;
      docsOf(name).clear();
      return { deletedDocs };
    }),
  };
  return { api, docs: (name: string) => docsOf(name) };
}

/**
 * A fake of the BO API: context, user, theme, settings, API info, storage, notify, log, and the
 * listeners to emit events.
 */
export function fakeBo(overrides: Record<string, unknown> = {}) {
  const listeners = new Map<string, Set<Listener>>();
  const storage = createFakeStorage();
  const api = {
    protocolVersion: 2,
    getContext: async () => ({ fleetId: 'FLEET-1', locale: 'en_GB', basename: '/' }),
    getCurrentUser: async () => ({ id: 'user-1', fullName: 'Jane Doe', roles: [] }),
    getTheme: async () => ({ palette: {}, typography: {}, mode: 'light' }),
    getSettings: vi.fn(async () => ({ ...VALID_SETTINGS })),
    getApiInfo: async () => ({ baseUrl: API_BASE_URL, apiKey: 'test' }),
    notify: vi.fn(async () => null),
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    storage: storage.api,
    on: (name: string, listener: Listener) => {
      listeners.set(name, (listeners.get(name) ?? new Set()).add(listener));
    },
    off: vi.fn((name: string, listener: Listener) => {
      listeners.get(name)?.delete(listener);
    }),
    ...overrides,
  };
  const emit = (name: string, data: unknown) => listeners.get(name)?.forEach((l) => l(data));
  return { api, emit, storage };
}

/** A JSON `Response`, with headers. */
export const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
