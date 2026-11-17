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
export interface BookingAction { id: string; label: string; run: (ctx: BookingContext) => void; disabled?: boolean; tone?: 'primary' | 'default' | 'danger' }
export interface BookingFilter { id: string; label: string; tabs: ListTab[]; test: (ctx: BookingContext) => boolean; needsAllPages: boolean }
export interface BookingKpi { id: string; label: string; tab: ListTab; filterId: string; tone: 'warn' | 'err' | 'info' }
export interface DetailCard { id: string; order: number; render: (ctx: BookingContext) => ReactNode }
/** A feature plugs columns, actions, filters, KPIs and detail cards into the list and the drawer. */
export interface BookingFeature {
  id: string;
  columns?: (tab: ListTab) => ListGridColumn<BookingContext>[];
  primaryAction?: (ctx: BookingContext) => BookingAction | null;
  menuActions?: (ctx: BookingContext) => BookingAction[];
  filters?: BookingFilter[];
  kpis?: BookingKpi[];
  detailCards?: DetailCard[];
  /** Rendered once at the root (dialogs). */
  Host?: () => ReactNode;
}
