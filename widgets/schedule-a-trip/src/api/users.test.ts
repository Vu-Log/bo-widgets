import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../test/fake-bo';
import { getRegistrationOverview, listUsersByIds, MAX_USER_IDS, searchCustomers } from './users';

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

describe('searchCustomers', () => {
  it('keeps the users found, with their names only', async () => {
    const authFetch = vi.fn<AuthFetch>(async () =>
      jsonResponse([
        { type: 'user', id: 'user-1', firstname: 'Jane', lastname: 'Doe', username: 'jane.doe', email: 'never-kept' },
        { type: 'vehicle', id: 'vehicle-1', plate: 'AB-123-CD' },
        { type: 'user' },
      ]),
    );
    const result = await searchCustomers(authFetch, 'FLEET-1', ' jane doe ');
    expect(result).toEqual({
      ok: true,
      data: [{ id: 'user-1', firstName: 'Jane', lastName: 'Doe', userName: 'jane.doe' }],
    });
    expect(authFetch.mock.calls[0]?.[0]).toBe('search/fleets/FLEET-1/search/jane%20doe');
  });

  it('removes the spaces of a phone number', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => jsonResponse([]));
    await searchCustomers(authFetch, 'FLEET-1', '+33 6 00 00 00 00');
    expect(authFetch.mock.calls[0]?.[0]).toBe('search/fleets/FLEET-1/search/%2B33600000000');
  });

  it('reads a 404 as nothing found, and calls nothing for a blank text', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('', { status: 404 }));
    expect(await searchCustomers(authFetch, 'FLEET-1', 'x')).toEqual({ ok: true, data: [] });
    const unused = vi.fn<AuthFetch>();
    expect(await searchCustomers(unused, 'FLEET-1', '  ')).toEqual({ ok: true, data: [] });
    expect(unused).not.toHaveBeenCalled();
  });

  it('keeps another failure', async () => {
    const authFetch = vi.fn<AuthFetch>(async () => new Response('', { status: 403 }));
    const result = await searchCustomers(authFetch, 'FLEET-1', 'x');
    expect(result.ok ? null : result.error.kind).toBe('not-allowed');
  });
});

describe('getRegistrationOverview', () => {
  it('gives the profiles with their approved services, and the catalogue', async () => {
    const authFetch = vi.fn<AuthFetch>(async () =>
      jsonResponse([
        {
          userId: 'user-1',
          catalog: [{ id: 's-1', name: 'Cars', type: 'FREE_FLOATING', fleetId: 'FLEET-1', cityId: 'c-1', zones: [] }],
          profiles: [
            { profileId: 'p-1', profileType: 'Single', profileStatus: 'APPROVED', services: { approved: ['s-1'], pending: [] } },
            { profileId: 'p-2', profileType: 'Business', profileStatus: 'SUSPENDED' },
          ],
        },
      ]),
    );
    const result = await getRegistrationOverview(authFetch, 'FLEET-1', 'user-1');
    expect(authFetch.mock.calls[0]?.[0]).toBe('user/fleets/FLEET-1/serviceRegistrationOverview?userId=user-1');
    expect(result).toEqual({
      ok: true,
      data: {
        profiles: [
          { profileId: 'p-1', type: 'Single', status: 'APPROVED', approvedServiceIds: ['s-1'] },
          { profileId: 'p-2', type: 'Business', status: 'SUSPENDED', approvedServiceIds: [] },
        ],
        services: [{ id: 's-1', name: 'Cars', type: 'FREE_FLOATING', fleetId: 'FLEET-1', cityId: 'c-1' }],
      },
    });
  });

  it('gives nothing for an unknown customer, and keeps a failure', async () => {
    const empty = vi.fn<AuthFetch>(async () => jsonResponse([]));
    expect(await getRegistrationOverview(empty, 'FLEET-1', 'u')).toEqual({ ok: true, data: { profiles: [], services: [] } });
    const failed = vi.fn<AuthFetch>(async () => new Response('', { status: 500 }));
    const result = await getRegistrationOverview(failed, 'FLEET-1', 'u');
    expect(result.ok ? null : result.error).toEqual({ kind: 'http', status: 500 });
  });
});
