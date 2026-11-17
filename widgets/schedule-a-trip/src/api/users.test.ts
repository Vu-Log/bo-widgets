import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../test/fake-bo';
import { listUsersByIds, MAX_USER_IDS } from './users';

const apiUser = {
  id: 'user-9',
  fleetId: 'FLEET-1',
  firstName: 'Jane',
  lastName: 'Doe',
  userName: 'jane.doe',
  birthDate: '1990-01-01T00:00:00Z',
  address: { streetName: '1 Example Street' },
  notes: 'private',
  profiles: [
    {
      id: 'profile-1',
      type: 'Business',
      email: 'jane@example.com',
      phoneNumber: '+33000000000',
      entity: { id: 'entity-1', name: 'Example Corp' },
    },
    { id: 'profile-2', type: 'Single' },
  ],
};

describe('listUsersByIds', () => {
  it('posts the ids and keeps only the names, user name and profile types and entities', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse([apiUser]));

    const result = await listUsersByIds(authFetch, 'FLEET-1', ['user-9', 'user-9']);

    expect(result).toEqual({
      ok: true,
      data: [
        {
          id: 'user-9',
          firstName: 'Jane',
          lastName: 'Doe',
          userName: 'jane.doe',
          profiles: [
            { id: 'profile-1', type: 'Business', entityId: 'entity-1' },
            { id: 'profile-2', type: 'Single', entityId: null },
          ],
        },
      ],
    });
    const [path, init] = authFetch.mock.calls[0] ?? [];
    expect(path).toBe('user/fleets/FLEET-1/users/list');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('["user-9"]');
  });

  it('gives null names and no profiles when the API leaves them out', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse([{ id: 'user-1' }]));
    expect(await listUsersByIds(authFetch, 'FLEET-1', ['user-1'])).toEqual({
      ok: true,
      data: [{ id: 'user-1', firstName: null, lastName: null, userName: null, profiles: [] }],
    });
  });

  it('resolves no customer without a call for no id', async () => {
    const authFetch = vi.fn<AuthFetch>();
    expect(await listUsersByIds(authFetch, 'FLEET-1', [])).toEqual({ ok: true, data: [] });
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('refuses more than 100 ids without a call', async () => {
    const authFetch = vi.fn<AuthFetch>();
    const ids = Array.from({ length: MAX_USER_IDS + 1 }, (_, index) => `user-${index}`);
    const result = await listUsersByIds(authFetch, 'FLEET-1', ids);
    expect(result.ok === false && result.error.kind).toBe('invalid-request');
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('accepts exactly 100 ids', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse([]));
    const ids = Array.from({ length: MAX_USER_IDS }, (_, index) => `user-${index}`);
    expect((await listUsersByIds(authFetch, 'FLEET-1', ids)).ok).toBe(true);
  });

  it('maps a 403 to not-allowed', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('', { status: 403 }));
    expect(await listUsersByIds(authFetch, 'FLEET-1', ['user-1'])).toEqual({
      ok: false,
      error: { kind: 'not-allowed', status: 403 },
    });
  });
});
