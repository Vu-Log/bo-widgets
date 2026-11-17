import { Box, Card, CardContent, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { apiErrorText, ApiRequestError } from '../../api/http';
import type { useI18n } from '../../i18n';

/**
 * A card of the detail drawer, with its title and an optional action.
 *
 * @param props - Title, action and content.
 * @returns The card.
 */
export function DetailCardFrame({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Card variant="outlined" component="section" aria-label={title}>
      <CardContent sx={{ display: 'grid', gap: 1.5, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="subtitle1" component="h3" sx={{ flex: 1 }}>
            {title}
          </Typography>
          {action}
        </Box>
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * The message of a failed query, translated: a 403 says the action is not allowed.
 *
 * @param error - The error of a query.
 * @param t - `useI18n().t`.
 * @returns The message.
 */
export function queryErrorText(error: Error, t: ReturnType<typeof useI18n>['t']): string {
  if (error instanceof ApiRequestError) {
    const { key, params } = apiErrorText(error.error);
    return t(key, params);
  }
  return t('common.unexpectedError');
}
