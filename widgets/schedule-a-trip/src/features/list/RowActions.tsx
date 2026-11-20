import { Box, Button, IconButton, ListItemText, Menu, MenuItem } from '@mui/material';
import { useState } from 'react';
import { useI18n } from '../../i18n';
import type { BookingAction, BookingContext, BookingFeature } from '../extensions';
import { isActionDisabled, WithDisabledReason } from './ActionReason';

/**
 * The primary action of a booking: the first non-null `primaryAction` of the features, in the
 * order of the registry.
 *
 * @param features - The features.
 * @param ctx - The booking.
 * @returns The action, or `null`.
 */
export function primaryActionOf(
  features: readonly BookingFeature[],
  ctx: BookingContext,
): BookingAction | null {
  for (const feature of features) {
    const action = feature.primaryAction?.(ctx) ?? null;
    if (action) return action;
  }
  return null;
}

/**
 * The other actions of a booking: the `menuActions` of every feature, in the order of the registry,
 * without the primary one.
 *
 * @param features - The features.
 * @param ctx - The booking.
 * @param primaryId - Id of the primary action, left out.
 * @returns The actions.
 */
export function menuActionsOf(
  features: readonly BookingFeature[],
  ctx: BookingContext,
  primaryId: string | null,
): BookingAction[] {
  return features
    .flatMap((feature) => feature.menuActions?.(ctx) ?? [])
    .filter((action) => action.id !== primaryId);
}

const buttonColor = (tone: BookingAction['tone']) =>
  tone === 'danger' ? 'error' : tone === 'default' ? 'inherit' : 'primary';

/**
 * The actions of a row: its primary action as a button, the others in a "⋯" menu.
 *
 * @param props - The booking and the features.
 * @returns The actions.
 */
export function RowActions({
  ctx,
  features,
}: {
  readonly ctx: BookingContext;
  readonly features: readonly BookingFeature[];
}) {
  const { t } = useI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const primary = primaryActionOf(features, ctx);
  const others = anchor === null ? [] : menuActionsOf(features, ctx, primary?.id ?? null);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'flex-end' }}>
      {primary && (
        <WithDisabledReason action={primary}>
          <Button
            size="small"
            variant={primary.tone === 'default' ? 'outlined' : 'contained'}
            color={buttonColor(primary.tone)}
            disabled={isActionDisabled(primary)}
            onClick={() => primary.run(ctx)}
            sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
            // The visible short label stays the accessible name (WCAG 2.5.3), the full one is the description.
            {...(primary.shortLabel ? { title: primary.label } : {})}
          >
            {primary.shortLabel ?? primary.label}
          </Button>
        </WithDisabledReason>
      )}
      <IconButton
        size="small"
        aria-label={t('action.more')}
        aria-haspopup="menu"
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        ⋯
      </IconButton>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {others.map((action) => (
          <MenuItem
            key={action.id}
            disabled={isActionDisabled(action)}
            sx={action.tone === 'danger' ? { color: 'error.main' } : undefined}
            onClick={() => {
              setAnchor(null);
              action.run(ctx);
            }}
          >
            {action.disabledReason ? (
              // A disabled item gets no pointer event: the reason is its second line, not a tooltip.
              <ListItemText primary={action.label} secondary={action.disabledReason} />
            ) : (
              action.label
            )}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
