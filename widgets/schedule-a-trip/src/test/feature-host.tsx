// Test helper: a minimal host of a BookingFeature, standing in for the list and the drawer. It
// reads the stored state of one booking with the real query and storage modules, then renders the
// columns, the actions, the detail cards and the Host of the feature for it.
import { useQuery } from '@tanstack/react-query';
import { useBoClient, useBoContext } from '@vulog/bo-widget-react';
import { useMemo } from 'react';
import type { ScheduledBooking } from '../api/schedule-a-trip';
import type { Customer } from '../api/users';
import type { ListTab } from '../domain/statuses';
import type { BookingContext, BookingFeature } from '../features/extensions';
import { bookingStateQueryOptions } from '../query/queries';
import { bookingsCollection } from '../storage/booking-state';

/** Props of {@link FeatureHost}. */
export interface FeatureHostProps {
  readonly feature: BookingFeature;
  readonly booking: ScheduledBooking;
  readonly tab: ListTab;
  readonly customer: Customer | undefined;
}

/**
 * Renders a feature for one booking: a row of its columns, its primary and menu actions as
 * buttons, its detail cards by order, and its Host.
 *
 * @param props - Feature, booking, tab and customer.
 * @returns The host.
 */
export function FeatureHost({ feature, booking, tab, customer }: FeatureHostProps) {
  const bo = useBoClient();
  const { fleetId } = useBoContext();
  const collection = useMemo(() => bookingsCollection(bo.storage), [bo]);
  const state = useQuery({ ...bookingStateQueryOptions(collection, fleetId ?? '', booking.id), enabled: Boolean(fleetId) });
  const ctx: BookingContext = { booking, tab, state: state.isSuccess ? state.data : undefined, customer };
  const primary = feature.primaryAction?.(ctx) ?? null;
  const actions = [...(primary ? [primary] : []), ...(feature.menuActions?.(ctx) ?? [])];
  const cards = [...(feature.detailCards ?? [])].sort((a, b) => a.order - b.order);
  const Host = feature.Host;
  return (
    <div>
      <div role="row" data-testid="row">
        {(feature.columns?.(tab) ?? []).map((column) => (
          <div role="gridcell" key={column.id} data-column={column.id}>
            {column.render(ctx)}
          </div>
        ))}
      </div>
      <div data-testid="actions">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={action.disabled === true || Boolean(action.disabledReason)}
            title={action.disabledReason}
            data-action={action.id}
            onClick={() => action.run(ctx)}
          >
            {action.label}
          </button>
        ))}
      </div>
      <div data-testid="cards">
        {cards.map((card) => (
          <section key={card.id}>{card.render(ctx)}</section>
        ))}
      </div>
      {Host && <Host />}
    </div>
  );
}
