import { describe, expect, it } from 'vitest';
import { ARCHIVE_AFTER_DAYS, lastActivity, storedDataStatus } from './archive';

const booking = {
  startDate: '2025-01-10T10:00:00Z',
  endDate: null,
  plannedReturnDate: '2025-01-12T10:00:00Z',
  cancellationDate: null,
};
const day = 86_400_000;

describe('lastActivity', () => {
  it('takes the latest of the dates', () => {
    expect(lastActivity(booking).toISOString()).toBe('2025-01-12T10:00:00.000Z');
    expect(
      lastActivity({ ...booking, cancellationDate: '2025-02-01T00:00:00Z' }).toISOString(),
    ).toBe('2025-02-01T00:00:00.000Z');
  });

  it('falls back to the start date alone', () => {
    expect(lastActivity({ ...booking, plannedReturnDate: null }).toISOString()).toBe(
      '2025-01-10T10:00:00.000Z',
    );
  });
});

describe('storedDataStatus', () => {
  const recent = new Date(Date.parse('2025-01-12T10:00:00Z') + 10 * day);
  const old = new Date(Date.parse('2025-01-12T10:00:00Z') + (ARCHIVE_AFTER_DAYS + 1) * day);

  it('is loading while the state is not read', () => {
    expect(storedDataStatus(booking, undefined, old)).toBe('loading');
  });

  it('is present with a document, however old', () => {
    expect(storedDataStatus(booking, { version: 1 }, old)).toBe('present');
  });

  it('is none without a document for a recent booking', () => {
    expect(storedDataStatus(booking, null, recent)).toBe('none');
  });

  it('is archived without a document after a year without activity', () => {
    expect(storedDataStatus(booking, null, old)).toBe('archived');
  });
});
