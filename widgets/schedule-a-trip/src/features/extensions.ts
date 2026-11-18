import type { ReactNode } from 'react';
import type { ListTab } from '../domain/statuses';
import type { ScheduledBooking } from '../api/schedule-a-trip';
import type { Customer } from '../api/users';
import type { BookingStateDoc } from '../storage/booking-state';
import type { ListGridColumn } from '../ui/ListGrid';

/** Everything a feature knows about one booking row. */
export interface BookingContext {
  booking: ScheduledBooking;
  tab: ListTab;
  /** undefined while loading, null when the widget never wrote (or the document expired). */
  state: BookingStateDoc | null | undefined;
  /** undefined while loading. */
  customer: Customer | undefined;
}
/**
 * An action of a row or of the drawer. `disabledReason`, a final text, says why it cannot run: the
 * list and the drawer show it next to the disabled action (a tooltip, or the second line of a menu
 * item). A reason implies `disabled`.
 */
export interface BookingAction { id: string; label: string; /** Shorter label of the row button, the full one in its tooltip. */ shortLabel?: string; run: (ctx: BookingContext) => void; disabled?: boolean; disabledReason?: string; tone?: 'primary' | 'default' | 'danger' }
export interface BookingFilter { id: string; label: string; tabs: ListTab[]; test: (ctx: BookingContext) => boolean; needsAllPages: boolean }
export interface BookingKpi { id: string; label: string; tab: ListTab; filterId: string; tone: 'warn' | 'err' | 'info' }
/**
 * A card of the drawer. A card whose code is lazy (`lazyModule`) gives its `preload`, so that the
 * drawer loads it ahead of time with its own chunk: `LazyModule.preload`, which never rejects (the
 * render shows the failure). The drawer ignores a preload that rejects anyway.
 */
export interface DetailCard { id: string; order: number; render: (ctx: BookingContext) => ReactNode; preload?: () => Promise<void> }
/**
 * A column of the list. `hiddenByDefault`: shown only once the operator picks it in the Columns
 * menu (a column for some operators only, or too wide for the default set).
 */
export type BookingColumn = ListGridColumn<BookingContext> & { readonly hiddenByDefault?: boolean };
/** A feature plugs columns, actions, filters, KPIs and detail cards into the list and the drawer. */
export interface BookingFeature {
  id: string;
  columns?: (tab: ListTab) => BookingColumn[];
  primaryAction?: (ctx: BookingContext) => BookingAction | null;
  menuActions?: (ctx: BookingContext) => BookingAction[];
  filters?: BookingFilter[];
  kpis?: BookingKpi[];
  detailCards?: DetailCard[];
  /** Rendered once at the root (dialogs). */
  Host?: () => ReactNode;
}
