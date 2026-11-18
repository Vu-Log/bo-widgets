import { Box, Button, Typography } from '@mui/material';
import { useI18n } from '../../i18n';
import type { BookingKpi } from '../extensions';

/**
 * The quick filters of the header: one button per KPI of the features, with its count when the
 * rows of its tab are all loaded. A click shows its tab with its filter alone; a second click
 * clears it.
 *
 * @param props - The KPIs, their counts, the one active and the handler.
 * @returns The bar, nothing without KPI.
 */
export function KpiBar({
  kpis,
  counts,
  activeId,
  onSelect,
}: {
  readonly kpis: readonly BookingKpi[];
  readonly counts: ReadonlyMap<string, number>;
  readonly activeId: string | null;
  readonly onSelect: (kpi: BookingKpi) => void;
}) {
  const { t, formatNumber } = useI18n();
  if (kpis.length === 0) return null;
  const tones = { warn: 'warning', err: 'error', info: 'info' } as const;
  return (
    <Box
      role="group"
      aria-label={t('kpi.label')}
      sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', px: 2, py: 1, flex: 'none' }}
    >
      {kpis.map((kpi) => {
        const count = counts.get(kpi.id);
        return (
          <Button
            key={kpi.id}
            size="small"
            variant={activeId === kpi.id ? 'contained' : 'outlined'}
            color={tones[kpi.tone]}
            aria-pressed={activeId === kpi.id}
            onClick={() => onSelect(kpi)}
            sx={{ textTransform: 'none', gap: 1 }}
          >
            {count !== undefined && (
              <Typography component="b" variant="subtitle2">
                {formatNumber(count)}
              </Typography>
            )}
            {kpi.label}
          </Button>
        );
      })}
    </Box>
  );
}
