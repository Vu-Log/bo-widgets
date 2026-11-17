import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Drawer,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import { Fragment, useMemo, type KeyboardEvent } from 'react';
import { storedDataStatus } from '../../domain/archive';
import { customerName, initialsOf, isBusinessBooking } from '../../domain/customers';
import { lifecycle } from '../../domain/lifecycle';
import { useI18n } from '../../i18n';
import { SkeletonCell } from '../../ui/SkeletonCell';
import { queryErrorText } from '../core/cards';
import type { BookingContext, BookingFeature } from '../extensions';
import { primaryActionOf } from '../list/RowActions';
import { SectionProvider, useSection } from '../section-context';
import { Timeline } from './Timeline';
import { useDetailContext } from './use-detail-context';

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

/** The header of the drawer: customer, status, id, navigation and the primary action. */
function DrawerHeader({
  ctx,
  features,
  onClose,
  onPrevious,
  onNext,
}: {
  readonly ctx: BookingContext;
} & Omit<BookingDrawerProps, 'bookingId' | 'fromList'>) {
  const { t } = useI18n();
  const { now } = useSection();
  const name = ctx.customer ? customerName(ctx.customer) : null;
  const customerStatus = useSection().customerStatus(ctx.booking.userId);
  const business = ctx.customer ? isBusinessBooking(ctx.customer, ctx.booking.profileId) : null;
  const primary = primaryActionOf(features, ctx);
  const stored = storedDataStatus(ctx.booking, ctx.state, now);
  const steps = useMemo(
    () => lifecycle({ tab: ctx.tab, booking: ctx.booking, state: ctx.state?.value ?? null }),
    [ctx],
  );
  return (
    <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'grid', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Avatar aria-hidden="true">{name ? initialsOf(name) : ''}</Avatar>
        <Typography variant="h6" component="h2" sx={{ flex: 1, minWidth: 0 }} noWrap>
          {name ??
            (customerStatus === 'loading' ? (
              <SkeletonCell width={160} />
            ) : customerStatus === 'error' ? (
              t('customer.loadFailed')
            ) : (
              t('common.none')
            ))}
        </Typography>
        <IconButton aria-label={t('detail.previous')} onClick={onPrevious} disabled={!onPrevious}>
          ↑
        </IconButton>
        <IconButton aria-label={t('detail.next')} onClick={onNext} disabled={!onNext}>
          ↓
        </IconButton>
        <IconButton aria-label={t('detail.close')} onClick={onClose}>
          ✕
        </IconButton>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Chip size="small" label={t(`tabs.${ctx.tab}`)} color={ctx.tab === 'alert' ? 'error' : 'default'} />
        {business && <Chip size="small" variant="outlined" label={t('customer.b2b')} />}
        {stored === 'archived' && (
          <Tooltip title={t('stored.archivedHint')}>
            <Chip size="small" label={t('stored.archived')} />
          </Tooltip>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
          #{ctx.booking.id}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {primary && stored !== 'archived' && (
          <Button
            size="small"
            variant="contained"
            color={primary.tone === 'danger' ? 'error' : 'primary'}
            disabled={primary.disabled}
            onClick={() => primary.run(ctx)}
          >
            {primary.label}
          </Button>
        )}
      </Box>
      <Timeline steps={steps} />
    </Box>
  );
}

/**
 * The detail of a booking, in a drawer over the list: header with the customer, the status, the
 * lifecycle and the primary action, then the cards of the features by `order`. ↑ and ↓ open the
 * booking before or after it in the list, Escape closes it.
 *
 * @param props - The open booking, the features and the navigation.
 * @returns The drawer.
 */
export function BookingDrawer(props: BookingDrawerProps) {
  const { bookingId, onClose, onPrevious, onNext } = props;
  const onKeyDown = (event: KeyboardEvent) => {
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
      {bookingId !== null && <DrawerBody {...props} bookingId={bookingId} />}
    </Drawer>
  );
}

function DrawerBody(props: BookingDrawerProps & { readonly bookingId: string }) {
  const { t } = useI18n();
  const section = useSection();
  const detail = useDetailContext(section.fleetId, props.bookingId, props.fromList);
  const sectionValue = useMemo(() => {
    if (detail.status !== 'ready') return section;
    return {
      ...section,
      customerStatus: (userId: string | null) =>
        userId !== null && userId === detail.ctx.booking.userId
          ? detail.customerStatus
          : section.customerStatus(userId),
      statesFailed: section.statesFailed || detail.stateError !== null,
    };
  }, [section, detail]);
  const cards = useMemo(
    () =>
      props.features
        .flatMap((feature) => feature.detailCards ?? [])
        .map((card, index) => ({ card, index }))
        .sort((a, b) => a.card.order - b.card.order || a.index - b.index)
        .map(({ card }) => card),
    [props.features],
  );

  if (detail.status === 'error') {
    return (
      <Box sx={{ p: 2, display: 'grid', gap: 2 }}>
        <Alert severity="error" role="alert">
          {queryErrorText(detail.error, t)}
        </Alert>
        <Button onClick={props.onClose}>{t('detail.close')}</Button>
      </Box>
    );
  }
  if (detail.status === 'loading') {
    return (
      <Box sx={{ p: 2 }} aria-busy="true">
        <SkeletonCell width="60%" />
        <SkeletonCell />
        <SkeletonCell />
      </Box>
    );
  }
  const ctx = detail.ctx;
  return (
    <SectionProvider value={sectionValue}>
      <Box role="dialog" aria-label={t('detail.label')} sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <DrawerHeader ctx={ctx} {...props} />
        {detail.stateError && (
          <Alert
            severity="warning"
            sx={{ borderRadius: 0 }}
            action={
              <Button color="inherit" size="small" onClick={detail.retryState}>
                {t('grid.retry')}
              </Button>
            }
          >
            {t('detail.stateFailed')}
          </Alert>
        )}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            p: 2,
            display: 'grid',
            gap: 2,
            alignContent: 'start',
            // A card hides its overflow, so its row would shrink to fit the drawer.
            gridAutoRows: 'max-content',
          }}
        >
          {cards.map((card) => (
            <Fragment key={card.id}>{card.render(ctx)}</Fragment>
          ))}
        </Box>
      </Box>
    </SectionProvider>
  );
}
