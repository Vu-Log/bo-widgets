import { Box, Typography } from '@mui/material';
import type { LifecycleStep } from '../../domain/lifecycle';
import { useI18n } from '../../i18n';
import { useSection } from '../section-context';

const DOT_COLORS = {
  done: 'success.main',
  current: 'primary.main',
  todo: 'action.disabled',
  failed: 'error.main',
} as const;

/**
 * The life of a booking, step by step, with the date of each step when known.
 *
 * @param props - The steps of `lifecycle`.
 * @returns The timeline, as an ordered list.
 */
export function Timeline({ steps }: { readonly steps: readonly LifecycleStep[] }) {
  const { t, formatDateInZone } = useI18n();
  const { timeZone } = useSection();
  return (
    <Box
      component="ol"
      aria-label={t('lifecycle.label')}
      sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', listStyle: 'none', m: 0, p: 0 }}
    >
      {steps.map((step) => (
        <Box
          component="li"
          key={step.id}
          data-step={step.id}
          data-state={step.state}
          aria-current={step.state === 'current' ? 'step' : undefined}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}
        >
          <Box
            aria-hidden="true"
            sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: DOT_COLORS[step.state] }}
          />
          <Box>
            <Typography
              variant="caption"
              component="div"
              sx={{ fontWeight: step.state === 'current' ? 700 : 400 }}
              color={step.state === 'todo' ? 'text.secondary' : 'text.primary'}
            >
              {t(`lifecycle.${step.id}`)}
            </Typography>
            {step.at && (
              <Typography variant="caption" color="text.secondary" component="div">
                {formatDateInZone(new Date(step.at), 'P', timeZone)}
              </Typography>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
