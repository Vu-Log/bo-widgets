import { Box, Button, Drawer } from '@mui/material';
import type { KeyboardEvent } from 'react';
import { useI18n } from '../../i18n';
import { lazyComponent } from '../../ui/lazy';
import { ChunkError, LazyBoundary } from '../../ui/LazyBoundary';
import type { BookingContext, BookingFeature } from '../extensions';
import { DrawerSkeleton } from './DrawerSkeleton';

/** Props of {@link BookingDrawer}. */
export interface BookingDrawerProps {
  readonly bookingId: string | null;
  /** Its row in the list, if loaded. */
  readonly fromList: BookingContext | undefined;
  readonly features: readonly BookingFeature[];
  readonly onClose: () => void;
  /** Opens the row before or after it in the list; `undefined` at an end. */
  readonly onPrevious: (() => void) | undefined;
  readonly onNext: (() => void) | undefined;
}

const DRAWER_WIDTH = 'min(560px, 100%)';

const LazyDrawerBody = lazyComponent('drawer', () =>
  import('./DrawerBody').then((module) => module.DrawerBody),
);

/**
 * Loads the chunks of the detail ahead of time (row hover or focus, idle time): the drawer and the
 * lazy cards of the features. Never rejects.
 *
 * @param features - The features whose cards to load.
 * @returns Settles when every chunk is loaded or failed.
 */
export function preloadDetail(features: readonly BookingFeature[]): Promise<void> {
  const cards = features.flatMap((feature) => feature.detailCards ?? []);
  // A preload of a feature that throws or rejects must not reach the event handlers that call this.
  return Promise.allSettled([
    LazyDrawerBody.preload(),
    ...cards.map((card) => Promise.resolve().then(() => card.preload?.())),
  ]).then(() => undefined);
}

/** The Close button of the drawer when its chunk failed. */
function CloseButton({ onClose }: { readonly onClose: () => void }) {
  const { t } = useI18n();
  return <Button onClick={onClose}>{t('detail.close')}</Button>;
}

/**
 * The detail of a booking, in a drawer over the list: header with the customer, the status, the
 * lifecycle and the primary action, then the cards of the features by `order`. The drawer itself
 * is in `index.js`; its content is a chunk loaded on demand, with a skeleton meanwhile. ↑ and ↓ open the
 * booking before or after it in the list, Escape closes it.
 *
 * @param props - The open booking, the features and the navigation.
 * @returns The drawer.
 */
export function BookingDrawer(props: BookingDrawerProps) {
  const { bookingId, onClose, onPrevious, onNext } = props;
  const onKeyDown = (event: KeyboardEvent) => {
    // A key the map (or another control) already handled: its arrows pan the map.
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"], [role="listbox"]')) return;
    if (event.key === 'ArrowUp' && onPrevious) {
      event.preventDefault();
      onPrevious();
    } else if (event.key === 'ArrowDown' && onNext) {
      event.preventDefault();
      onNext();
    }
  };
  return (
    <Drawer
      anchor="right"
      open={bookingId !== null}
      onClose={onClose}
      onKeyDown={onKeyDown}
      slotProps={{ paper: { sx: { width: DRAWER_WIDTH } } }}
    >
      {bookingId !== null && (
        <LazyBoundary
          fallback={<DrawerSkeleton />}
          renderError={(retry) => (
            <Box sx={{ p: 2, display: 'grid', gap: 2 }}>
              <ChunkError onRetry={retry} />
              <CloseButton onClose={onClose} />
            </Box>
          )}
        >
          <LazyDrawerBody {...props} bookingId={bookingId} />
        </LazyBoundary>
      )}
    </Drawer>
  );
}
