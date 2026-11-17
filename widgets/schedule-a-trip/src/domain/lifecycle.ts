import type { ListTab } from './statuses';

/** A step of the life of a booking. */
export type LifecycleStepId =
  | 'created'
  | 'prepaid'
  | 'preallocated'
  | 'allocated'
  | 'inProgress'
  | 'completed'
  | 'cancelled'
  | 'refunded'
  | 'regularized';

/** `done`; `current`: the next step to reach; `todo`; `failed`: the cancellation. */
export type LifecycleStepState = 'done' | 'current' | 'todo' | 'failed';

/** A step of the timeline, with its date when known. */
export interface LifecycleStep {
  readonly id: LifecycleStepId;
  readonly state: LifecycleStepState;
  /** ISO date, `null` when unknown. */
  readonly at: string | null;
}

/** What {@link lifecycle} reads of a booking and of its stored state. */
export interface LifecycleInput {
  readonly tab: ListTab;
  readonly booking: {
    readonly creationDate: string | null;
    readonly cancellationDate: string | null;
    readonly endDate: string | null;
    readonly vehicleId: string | null;
  };
  /** Fields of the stored state; `null` when there is none. */
  readonly state: {
    readonly isB2B?: boolean | null | undefined;
    readonly chargeStartedAt?: string | null | undefined;
    readonly invoiceId?: string | null | undefined;
    readonly preallocatedVehicleId?: string | null | undefined;
    readonly refundedAt?: string | null | undefined;
    readonly toRegularize?: { readonly at: string } | null | undefined;
    readonly regularizedAt?: string | null | undefined;
  } | null;
}

type Draft = { id: LifecycleStepId; done: boolean; at: string | null; failed?: boolean };

/** Marks the first step not done after the last done one as `current`, unless the cycle is over. */
const withStates = (drafts: readonly Draft[], over: boolean): LifecycleStep[] => {
  const lastDone = drafts.reduce((last, draft, index) => (draft.done ? index : last), -1);
  return drafts.map((draft, index) => ({
    id: draft.id,
    at: draft.at,
    state: draft.failed
      ? 'failed'
      : draft.done
        ? 'done'
        : !over && index === lastDone + 1
          ? 'current'
          : 'todo',
  }));
};

/**
 * The timeline of a booking: created → prepaid → pre-allocated → allocated → in progress →
 * completed, or created → (prepaid) → cancelled → refunded → regularized. The prepayment steps only
 * appear when they apply: no prepayment for a business booking, no refund without an invoice, no
 * regularization without fees left unpaid.
 *
 * @param input - Tab, dates and vehicle of the booking, and its stored state.
 * @returns The steps, in order.
 */
export function lifecycle({ tab, booking, state }: LifecycleInput): LifecycleStep[] {
  const created: Draft = { id: 'created', done: true, at: booking.creationDate };
  const charged = Boolean(state?.invoiceId);
  const prepaid: Draft = { id: 'prepaid', done: charged, at: state?.chargeStartedAt ?? null };

  if (tab === 'cancelled') {
    const drafts: Draft[] = [created];
    if (charged) drafts.push(prepaid);
    drafts.push({ id: 'cancelled', done: true, failed: true, at: booking.cancellationDate });
    if (charged) {
      drafts.push({ id: 'refunded', done: Boolean(state?.refundedAt), at: state?.refundedAt ?? null });
    }
    if (state?.toRegularize) {
      drafts.push({
        id: 'regularized',
        done: Boolean(state.regularizedAt),
        at: state.regularizedAt ?? null,
      });
    }
    return withStates(drafts, false);
  }

  const started = tab === 'ongoing' || tab === 'completed';
  const allocated = booking.vehicleId !== null || started;
  const drafts: Draft[] = [created];
  if (state?.isB2B !== true) drafts.push(prepaid);
  drafts.push(
    {
      id: 'preallocated',
      done: Boolean(state?.preallocatedVehicleId) || allocated,
      at: null,
    },
    { id: 'allocated', done: allocated, at: null },
    { id: 'inProgress', done: tab === 'completed', at: null },
    { id: 'completed', done: tab === 'completed', at: tab === 'completed' ? booking.endDate : null },
  );
  const steps = withStates(drafts, tab === 'completed');
  // A trip in progress is the current step, even when the steps before were skipped.
  return tab === 'ongoing'
    ? steps.map((step) => (step.id === 'inProgress' ? { ...step, state: 'current' } : step))
    : steps;
}
