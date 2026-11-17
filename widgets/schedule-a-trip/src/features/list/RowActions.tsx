import { Box, Button, IconButton, Menu, MenuItem } from '@mui/material';
import { useState } from 'react';
import { useI18n } from '../../i18n';
import type { BookingAction, BookingContext, BookingFeature } from '../extensions';

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
        <Button
          size="small"
          variant={primary.tone === 'default' ? 'outlined' : 'contained'}
          color={buttonColor(primary.tone)}
          disabled={primary.disabled}
          onClick={() => primary.run(ctx)}
          sx={{ textTransform: 'none' }}
        >
          {primary.label}
        </Button>
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
            disabled={action.disabled}
            sx={action.tone === 'danger' ? { color: 'error.main' } : undefined}
            onClick={() => {
              setAnchor(null);
              action.run(ctx);
            }}
          >
            {action.label}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
