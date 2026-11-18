import { describe, expect, it } from 'vitest';
import { lifecycle, type LifecycleInput } from './lifecycle';

const booking: LifecycleInput['booking'] = {
  creationDate: '2026-03-01T10:00:00Z',
  cancellationDate: null,
  endDate: null,
  vehicleId: null,
};

const states = (input: LifecycleInput) =>
  lifecycle(input).map((step) => `${step.id}:${step.state}`);

describe('lifecycle', () => {
  it('starts an upcoming booking at the prepayment', () => {
    expect(states({ tab: 'upcoming', booking, state: null })).toEqual([
      'created:done',
      'prepaid:current',
      'preallocated:todo',
      'allocated:todo',
      'inProgress:todo',
      'completed:todo',
    ]);
    expect(lifecycle({ tab: 'upcoming', booking, state: null })[0]?.at).toBe(booking.creationDate);
  });

  it('skips the prepayment of a business booking', () => {
    expect(states({ tab: 'upcoming', booking, state: { isB2B: true } })).toEqual([
      'created:done',
      'preallocated:current',
      'allocated:todo',
      'inProgress:todo',
      'completed:todo',
    ]);
  });

  it('follows a prepaid and pre-allocated booking', () => {
    const state = {
      chargeStartedAt: '2026-03-02T10:00:00Z',
      invoiceId: 'invoice-1',
      preallocatedVehicleId: 'vehicle-1',
    };
    const steps = lifecycle({ tab: 'alert', booking, state });
    expect(steps.map((step) => step.state)).toEqual(['done', 'done', 'done', 'current', 'todo', 'todo']);
    expect(steps[1]?.at).toBe('2026-03-02T10:00:00Z');
  });

  it('marks the trip of an ongoing booking as current', () => {
    expect(states({ tab: 'ongoing', booking: { ...booking, vehicleId: 'v' }, state: null })).toEqual([
      'created:done',
      'prepaid:todo',
      'preallocated:done',
      'allocated:done',
      'inProgress:current',
      'completed:todo',
    ]);
  });

  it('ends a completed booking with its return date and no current step', () => {
    const steps = lifecycle({
      tab: 'completed',
      booking: { ...booking, endDate: '2026-03-12T10:00:00Z' },
      state: null,
    });
    expect(steps.some((step) => step.state === 'current')).toBe(false);
    expect(steps.at(-1)).toEqual({ id: 'completed', state: 'done', at: '2026-03-12T10:00:00Z' });
  });

  it('shows the cancellation alone when nothing was charged', () => {
    expect(
      states({
        tab: 'cancelled',
        booking: { ...booking, cancellationDate: '2026-03-05T10:00:00Z' },
        state: null,
      }),
    ).toEqual(['created:done', 'cancelled:failed']);
  });

  it('follows the refund and the regularization of a cancelled booking', () => {
    const base = { chargeStartedAt: '2026-03-02T10:00:00Z', invoiceId: 'invoice-1' };
    expect(states({ tab: 'cancelled', booking, state: base })).toEqual([
      'created:done',
      'prepaid:done',
      'cancelled:failed',
      'refunded:current',
    ]);
    expect(
      states({
        tab: 'cancelled',
        booking,
        state: {
          ...base,
          refundedAt: '2026-03-06T10:00:00Z',
          toRegularize: { at: '2026-03-06T10:00:00Z' },
          regularizedAt: null,
        },
      }),
    ).toEqual(['created:done', 'prepaid:done', 'cancelled:failed', 'refunded:done', 'regularized:current']);
  });
});
