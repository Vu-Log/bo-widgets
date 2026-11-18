import { Box, ButtonBase, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useI18n } from '../../i18n';
import type { BookingKpi } from '../extensions';

const TONES = { warn: 'warning', err: 'error', info: 'info' } as const;

/**
 * The quick filters of the header: one tile per KPI of the features, its count and its label. The
 * count of a filter shows once the rows of its tab are all loaded (or when the filter brings its own
 * bookings); a dash until then. A click shows its tab with its filter alone; a second click clears
 * it.
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
  return (
    <Box
      role="group"
      aria-label={t('kpi.label')}
      sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', px: 2, py: 1, flex: 'none' }}
    >
      {kpis.map((kpi) => {
        const count = counts.get(kpi.id);
        const active = activeId === kpi.id;
        const tone = TONES[kpi.tone];
        const tile = (
          <ButtonBase
            key={kpi.id}
            aria-pressed={active}
            onClick={() => onSelect(kpi)}
            sx={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 1,
              px: 1.5,
              py: 1,
              border: 1,
              borderColor: active ? 'primary.main' : 'divider',
              borderRadius: 2,
              bgcolor: (theme) => (active ? alpha(theme.palette.primary.main, 0.08) : theme.palette.background.paper),
              '&:hover': { borderColor: 'primary.main' },
              '&.Mui-focusVisible': { outline: 2, outlineColor: 'primary.main', outlineOffset: 2 },
            }}
          >
            <Typography
              component="b"
              sx={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: count === undefined ? 'text.disabled' : `${tone}.main` }}
            >
              {count === undefined ? '–' : formatNumber(count)}
            </Typography>
            <Typography component="span" variant="body2" color="text.secondary">
              {kpi.label}
            </Typography>
          </ButtonBase>
        );
        return count === undefined ? (
          // A description, not the name of the tile: its name stays its label.
          <Tooltip key={kpi.id} title={t('kpi.countUnknown')} describeChild>
            {tile}
          </Tooltip>
        ) : (
          tile
        );
      })}
    </Box>
  );
}
