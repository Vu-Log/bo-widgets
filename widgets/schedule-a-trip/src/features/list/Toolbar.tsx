import {
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState, type ReactNode, type Ref } from 'react';
import { useI18n } from '../../i18n';
import type { BookingFilter } from '../extensions';
import { DENSITIES, type Density } from './preferences';

/** A column the operator can show or hide. */
export interface PickableColumn {
  readonly id: string;
  readonly label: ReactNode;
  readonly shown: boolean;
}

/** Props of {@link Toolbar}. */
export interface ToolbarProps {
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly searchRef?: Ref<HTMLInputElement>;
  readonly filters: readonly BookingFilter[];
  readonly activeFilters: ReadonlySet<string>;
  readonly onToggleFilter: (id: string) => void;
  readonly density: Density;
  readonly onDensity: (density: Density) => void;
  readonly columns: readonly PickableColumn[];
  readonly onToggleColumn: (id: string, shown: boolean) => void;
  /** When the rows were received, in ms; 0 before. */
  readonly updatedAt: number;
  readonly now: Date;
  readonly onRefresh: () => void;
  readonly refreshing: boolean;
}

/**
 * The toolbar of the list, on one line while it fits: search (`/` focuses it, it shrinks first),
 * filter chips of the tab, then at the right the age of the rows, refresh, density and the column
 * picker, which wrap together on a narrow section.
 *
 * @param props - The values and their handlers.
 * @returns The toolbar.
 */
export function Toolbar(props: ToolbarProps) {
  const { t, formatRelative } = useI18n();
  const [columnsAnchor, setColumnsAnchor] = useState<HTMLElement | null>(null);
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        flexWrap: 'wrap',
        px: 2,
        py: 1,
        flex: 'none',
      }}
    >
      <TextField
        size="small"
        type="search"
        value={props.search}
        onChange={(event) => props.onSearch(event.target.value)}
        placeholder={t('toolbar.searchPlaceholder')}
        inputRef={props.searchRef}
        slotProps={{
          htmlInput: { 'aria-label': t('toolbar.search') },
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <Typography component="kbd" variant="caption" color="text.secondary">
                  /
                </Typography>
              </InputAdornment>
            ),
          },
        }}
        // The part that gives way: the toolbar stays on one line as long as it can.
        sx={{ flex: '1 1 200px', minWidth: 160, maxWidth: 380 }}
      />
      {props.filters.map((filter) => {
        const active = props.activeFilters.has(filter.id);
        return (
          <Chip
            key={filter.id}
            size="small"
            label={filter.label}
            color={active ? 'primary' : 'default'}
            variant={active ? 'filled' : 'outlined'}
            aria-pressed={active}
            onClick={() => props.onToggleFilter(filter.id)}
          />
        );
      })}
      {/* Kept together at the right; on a narrow section, they wrap as one block. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 'auto', flex: 'none' }}>
        <Typography variant="caption" color="text.secondary" aria-live="polite" noWrap>
          {props.updatedAt > 0 &&
            t('toolbar.updated', { ago: formatRelative(new Date(props.updatedAt), props.now) })}
        </Typography>
        <Tooltip title={t('toolbar.refresh')}>
          <span>
            <IconButton
              size="small"
              aria-label={t('toolbar.refresh')}
              onClick={props.onRefresh}
              disabled={props.refreshing}
            >
              ⟳
            </IconButton>
          </span>
        </Tooltip>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={props.density}
          aria-label={t('toolbar.density')}
          onChange={(_, value: Density | null) => value && props.onDensity(value)}
        >
          {(Object.keys(DENSITIES) as Density[]).map((density) => (
            <ToggleButton key={density} value={density} sx={{ textTransform: 'none', py: 0.25 }}>
              {t(`toolbar.density.${density}`)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Button
          size="small"
          variant="outlined"
          aria-haspopup="menu"
          onClick={(event) => setColumnsAnchor(event.currentTarget)}
        >
          {t('toolbar.columns')}
        </Button>
      </Box>
      <Menu anchorEl={columnsAnchor} open={columnsAnchor !== null} onClose={() => setColumnsAnchor(null)}>
        {props.columns.map((column) => (
          <MenuItem key={column.id} dense onClick={() => props.onToggleColumn(column.id, !column.shown)}>
            <FormControlLabel
              control={<Checkbox size="small" checked={column.shown} tabIndex={-1} />}
              label={column.label}
              onClick={(event) => event.preventDefault()}
            />
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
