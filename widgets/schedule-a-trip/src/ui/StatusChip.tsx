import { Box } from '@mui/material';
import { alpha, type SxProps, type Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';

/** The tone of a {@link StatusChip}: a colour of the palette of the theme. */
export type StatusTone = 'success' | 'warning' | 'error' | 'info' | 'default';

const baseSx = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.75,
  maxWidth: '100%',
  px: 1.125,
  py: 0.375,
  borderRadius: 3,
  fontSize: 12,
  fontWeight: 500,
  lineHeight: 1.5,
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  // The dot, in the colour of the text.
  '&::before': {
    content: '""',
    flex: 'none',
    width: 6,
    height: 6,
    borderRadius: '50%',
    bgcolor: 'currentColor',
  },
} as const;

const toneSx = (tone: StatusTone): SxProps<Theme> => (theme) => {
  if (tone === 'default') {
    return { ...baseSx, color: theme.palette.text.secondary, bgcolor: theme.palette.action.selected };
  }
  const palette = theme.palette[tone];
  const dark = theme.palette.mode === 'dark';
  return {
    ...baseSx,
    color: dark ? palette.light : palette.dark,
    bgcolor: alpha(palette.main, dark ? 0.2 : 0.12),
  };
};

/**
 * A status as a soft chip: a dot and a label on a light background of its tone, in the colours of
 * the theme of the back office. Not interactive; give it a tooltip from outside when needed.
 *
 * @param props - The tone and the label.
 * @returns The chip.
 */
export function StatusChip({ tone, label }: { readonly tone: StatusTone; readonly label: ReactNode }) {
  return (
    <Box component="span" data-status-chip={tone} sx={toneSx(tone)}>
      {label}
    </Box>
  );
}
