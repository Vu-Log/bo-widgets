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
 * The toolbar of the list: search (`/` focuses it), filter chips of the tab, refresh with the age of
 * the rows, density and the column picker.
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
        sx={{ minWidth: 260 }}
      />
      {props.filters.map((filter) => {
        const active = props.activeFilters.has(filter.id);
        return (
          <Chip
            key={filter.id}
            label={filter.label}
            color={active ? 'primary' : 'default'}
            variant={active ? 'filled' : 'outlined'}
            aria-pressed={active}
            onClick={() => props.onToggleFilter(filter.id)}
          />
        );
      })}
      <Box sx={{ flex: 1 }} />
      <Typography variant="caption" color="text.secondary" aria-live="polite">
        {props.updatedAt > 0 &&
          t('toolbar.updated', { ago: formatRelative(new Date(props.updatedAt), props.now) })}
      </Typography>
      <Tooltip title={t('toolbar.refresh')}>
        <span>
          <IconButton
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
          <ToggleButton key={density} value={density} sx={{ textTransform: 'none' }}>
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
