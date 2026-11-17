import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from '@tanstack/react-query-persist-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/http';
import { StorageRequestError } from '../storage/booking-state';
import {
  browserStorage,
  CACHE_VERSION,
  createPersistOptions,
  createWidgetQueryClient,
  persistKey,
  safeStorage,
  shouldPersistQuery,
  shouldRetryQuery,
  type KeyValueStorage,
} from './client';
import { queryKeys } from './keys';

/** A Storage in memory, as localStorage. */
const memoryStorage = () => {
  const items = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: vi.fn((key: string) => items.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void items.set(key, value)),
    removeItem: vi.fn((key: string) => void items.delete(key)),
  };
  return { storage, items };
};

afterEach(() => vi.restoreAllMocks());

describe('shouldRetryQuery', () => {
  it('retries a network failure and a 5xx twice at most', () => {
    const network = new ApiRequestError({ kind: 'network', cause: null });
    expect(shouldRetryQuery(0, network)).toBe(true);
    expect(shouldRetryQuery(1, new ApiRequestError({ kind: 'http', status: 503 }))).toBe(true);
    expect(shouldRetryQuery(2, network)).toBe(false);
  });

  it('never retries a 4xx, nor a storage failure', () => {
    expect(shouldRetryQuery(0, new ApiRequestError({ kind: 'not-allowed', status: 403 }))).toBe(
      false,
    );
    expect(shouldRetryQuery(0, new StorageRequestError({ kind: 'rate-limited' }))).toBe(false);
  });

  it('retries an unknown error like a passing one', () => {
    expect(shouldRetryQuery(0, new Error('boom'))).toBe(true);
  });
});

describe('createWidgetQueryClient', () => {
  it('never retries a mutation', () => {
    const client = createWidgetQueryClient();
    expect(client.getDefaultOptions().mutations?.retry).toBe(0);
    expect(client.getDefaultOptions().queries?.retry).toBe(shouldRetryQuery);
  });

  it('gives a new client each time', () => {
    expect(createWidgetQueryClient()).not.toBe(createWidgetQueryClient());
  });
});

describe('persistKey', () => {
  it('names the widget, the cache version and the fleet', () => {
    expect(persistKey('FLEET-1')).toBe(`schedule-a-trip:query-cache:v${CACHE_VERSION}:FLEET-1`);
  });
});

describe('safeStorage', () => {
  it('passes the calls through', () => {
    const { storage, items } = memoryStorage();
    const safe = safeStorage(storage, vi.fn());
    safe?.setItem('a', '1');
    expect(safe?.getItem('a')).toBe('1');
    safe?.removeItem('a');
    expect(items.size).toBe(0);
  });

  it('turns failures into a miss or a skipped write, and reports them', () => {
    const onError = vi.fn();
    const failure = new DOMException('full', 'QuotaExceededError');
    const broken: KeyValueStorage = {
      getItem: () => {
        throw failure;
      },
      setItem: () => {
        throw failure;
      },
      removeItem: () => {
        throw failure;
      },
    };
    const safe = safeStorage(broken, onError);

    expect(safe?.getItem('a')).toBeNull();
    expect(() => safe?.setItem('a', '1')).not.toThrow();
    expect(() => safe?.removeItem('a')).not.toThrow();
    expect(onError.mock.calls).toEqual([
      ['getItem', failure],
      ['setItem', failure],
      ['removeItem', failure],
    ]);
  });

  it('gives null without a storage', () => {
    expect(safeStorage(null, vi.fn())).toBeNull();
  });
});

describe('browserStorage', () => {
  it('gives localStorage', () => {
    expect(browserStorage(vi.fn())).toBe(globalThis.localStorage);
  });

  it('gives null and reports it when the browser refuses it', () => {
    const failure = new DOMException('denied', 'SecurityError');
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw failure;
    });
    const onError = vi.fn();
    expect(browserStorage(onError)).toBeNull();
    expect(onError).toHaveBeenCalledWith('localStorage', failure);
  });
});

describe('shouldPersistQuery', () => {
  it('persists a successful reference query only', () => {
    expect(
      shouldPersistQuery({
        queryKey: queryKeys.models('F'),
        state: { status: 'success' },
      } as never),
    ).toBe(true);
    expect(
      shouldPersistQuery({ queryKey: queryKeys.models('F'), state: { status: 'error' } } as never),
    ).toBe(false);
    expect(
      shouldPersistQuery({
        queryKey: queryKeys.customers('F', ['u']),
        state: { status: 'success' },
      } as never),
    ).toBe(false);
  });
});

describe('createPersistOptions', () => {
  const fill = () => {
    const client = createWidgetQueryClient();
    client.setQueryData(queryKeys.models('FLEET-1'), [{ id: 7, name: 'City car' }]);
    client.setQueryData(queryKeys.customers('FLEET-1', ['user-9']), [
      { id: 'user-9', firstName: 'Jane', lastName: 'Doe', userName: 'jane.doe', profiles: [] },
    ]);
    client.setQueryData(queryKeys.invoice('FLEET-1', 'invoice-1'), {
      id: 'invoice-1',
      status: 'PAID',
      amount: 20,
    });
    client.setQueryData(queryKeys.settings(), { ok: true, settings: { dayRate: 100 } });
    client.setQueryData(['unknown', 'FLEET-1'], { secret: 'never' });
    return client;
  };

  it('writes the reference data only, never a name, a payment status or the settings', async () => {
    const { storage, items } = memoryStorage();
    const options = createPersistOptions({
      fleetId: 'FLEET-1',
      storage,
      onError: vi.fn(),
      throttleTime: 0,
    });

    await persistQueryClientSave({ queryClient: fill(), ...options });

    await vi.waitFor(() => expect(items.get(persistKey('FLEET-1'))).toBeDefined());
    const saved = items.get(persistKey('FLEET-1')) ?? '';
    expect(saved).toContain('City car');
    expect(saved).not.toContain('Jane');
    expect(saved).not.toContain('jane.doe');
    expect(saved).not.toContain('PAID');
    expect(saved).not.toContain('dayRate');
    expect(saved).not.toContain('never');
    expect(saved).not.toContain('customers');
  });

  it('restores the reference data in a new client', async () => {
    const { storage } = memoryStorage();
    const options = createPersistOptions({
      fleetId: 'FLEET-1',
      storage,
      onError: vi.fn(),
      throttleTime: 0,
    });
    await persistQueryClientSave({ queryClient: fill(), ...options });
    await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalled());

    const restored = createWidgetQueryClient();
    await persistQueryClientRestore({ queryClient: restored, ...options });

    expect(restored.getQueryData(queryKeys.models('FLEET-1'))).toEqual([
      { id: 7, name: 'City car' },
    ]);
    expect(restored.getQueryData(queryKeys.customers('FLEET-1', ['user-9']))).toBeUndefined();
  });

  it('keeps one cache per fleet', async () => {
    const { storage, items } = memoryStorage();
    const options = createPersistOptions({
      fleetId: 'FLEET-2',
      storage,
      onError: vi.fn(),
      throttleTime: 0,
    });
    await persistQueryClientSave({ queryClient: fill(), ...options });
    await vi.waitFor(() => expect(items.has(persistKey('FLEET-2'))).toBe(true));
    expect(items.has(persistKey('FLEET-1'))).toBe(false);
  });

  it('goes on without a cache when the storage fails, and reports it', async () => {
    const onError = vi.fn();
    const failure = new DOMException('full', 'QuotaExceededError');
    const broken: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw failure;
      },
      removeItem: () => undefined,
    };
    const options = createPersistOptions({
      fleetId: 'FLEET-1',
      storage: broken,
      onError,
      throttleTime: 0,
    });

    await expect(
      persistQueryClientSave({ queryClient: fill(), ...options }),
    ).resolves.toBeUndefined();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('setItem', failure));
  });

  it('never persists mutations', () => {
    const options = createPersistOptions({ fleetId: 'FLEET-1', storage: null, onError: vi.fn() });
    expect(options.dehydrateOptions?.shouldDehydrateMutation?.({} as never)).toBe(false);
    expect(options.buster).toBe(CACHE_VERSION);
  });
});
