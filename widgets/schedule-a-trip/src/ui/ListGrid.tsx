import { Box, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { memo, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { SkeletonCell } from './SkeletonCell';
import { useEndReached, useVisibleRows, type RegisterRow } from './use-intersection';

/** A column of a {@link ListGrid}. */
export interface ListGridColumn<Row> {
  /** Unique among the columns. */
  readonly id: string;
  readonly header: ReactNode;
  /** Its track in `grid-template-columns`: `120px`, `minmax(160px, 2fr)`… */
  readonly width: string;
  readonly align?: 'left' | 'right';
  /** The content of its cell for a row. Subscribe to a query in it to enrich only this cell. */
  readonly render: (row: Row) => ReactNode;
}

/** Props of {@link ListGrid}. */
export interface ListGridProps<Row> {
  /** Accessible name of the grid. */
  readonly label: string;
  /** Keep the array stable (`useMemo`): the rows are memoized on it. */
  readonly columns: readonly ListGridColumn<Row>[];
  readonly rows: readonly Row[];
  /** Stable, unique id of a row. */
  readonly getRowId: (row: Row) => string;
  /** Height of a row in px: 48 by default (36 compact, 56 comfortable). */
  readonly rowHeight?: number;
  /** Total rows on the server, for `aria-rowcount`; unknown by default. */
  readonly totalCount?: number | null;
  /** Rows around the visible area that count as visible, and that trigger the next page. 20 by default. */
  readonly marginRows?: number;
  readonly hasNextPage?: boolean;
  /** Shows skeleton rows at the end while the next page loads. */
  readonly isFetchingNextPage?: boolean;
  /** Asked for when the end of the list comes near, while `hasNextPage` and not loading. */
  readonly onEndReached?: () => void;
  /** The ids of the rows in view, plus the margin: load their extra data only. */
  readonly onVisibleRowsChange?: (ids: ReadonlySet<string>) => void;
  /** Shown when there is no row and nothing is loading. */
  readonly empty?: ReactNode;
  /** Skeleton rows shown while loading. 3 by default. */
  readonly loadingRows?: number;
}

const DEFAULT_ROW_HEIGHT = 48;
const DEFAULT_MARGIN_ROWS = 20;

const rootSx: SxProps<Theme> = { flex: 1, minHeight: 0, overflow: 'auto' };
const tableSx: SxProps<Theme> = { display: 'block', minWidth: 'min-content' };
const groupSx: SxProps<Theme> = { display: 'block' };
const headSx: SxProps<Theme> = {
  display: 'block',
  position: 'sticky',
  top: 0,
  zIndex: 1,
  bgcolor: 'background.paper',
};
const rowSx: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: 'var(--grid-columns)',
  alignItems: 'center',
  minHeight: 'var(--row-height)',
};
// Rendered as a grid, not a table: CSS containment does not apply to table rows, so
// content-visibility would do nothing on a <tr>.
const bodyRowSx: SxProps<Theme> = {
  ...rowSx,
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto var(--row-height)',
};
const cellSx: SxProps<Theme> = {
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  py: 1,
};

interface RowProps<Row> {
  readonly row: Row;
  readonly rowId: string;
  readonly rowIndex: number;
  readonly columns: readonly ListGridColumn<Row>[];
  readonly register: RegisterRow;
}

function GridRow<Row>({ row, rowId, rowIndex, columns, register }: RowProps<Row>) {
  return (
    <TableRow
      component="div"
      role="row"
      aria-rowindex={rowIndex}
      data-row-id={rowId}
      ref={register(rowId)}
      sx={bodyRowSx}
    >
      {columns.map((column) => (
        <TableCell key={column.id} component="div" role="gridcell" align={column.align} sx={cellSx}>
          {column.render(row)}
        </TableCell>
      ))}
    </TableRow>
  );
}

/** A row only renders again when its row object, index, columns or register change. */
const MemoGridRow = memo(GridRow) as <Row>(props: RowProps<Row>) => ReactElement;

/**
 * A list built from the standard MUI table components rendered as `div`s, with ARIA roles grid,
 * row, columnheader and gridcell. Each row is a CSS grid sharing `grid-template-columns`, with
 * `content-visibility: auto` so that the browser skips the rows off screen while they all stay in
 * the DOM (find in page, screen readers, native scroll). The grid is its own scroll container,
 * with a sticky header: give it the remaining height of a column layout.
 *
 * @param props - Columns, rows and the paging callbacks.
 * @returns The grid.
 */
export function ListGrid<Row>({
  label,
  columns,
  rows,
  getRowId,
  rowHeight = DEFAULT_ROW_HEIGHT,
  totalCount = null,
  marginRows = DEFAULT_MARGIN_ROWS,
  hasNextPage = false,
  isFetchingNextPage = false,
  onEndReached,
  onVisibleRowsChange,
  empty,
  loadingRows = 3,
}: ListGridProps<Row>) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const marginPx = marginRows * rowHeight;
  const register = useVisibleRows({ root, marginPx, onChange: onVisibleRowsChange ?? noop });
  const endRef = useEndReached({
    root,
    marginPx,
    enabled: hasNextPage && !isFetchingNextPage && onEndReached !== undefined,
    onEndReached: onEndReached ?? noop,
  });
  const style = {
    '--grid-columns': columns.map((column) => column.width).join(' '),
    '--row-height': `${rowHeight}px`,
  } as CSSProperties;

  return (
    <Box ref={setRoot} sx={rootSx}>
      <Table
        component="div"
        role="grid"
        aria-label={label}
        aria-rowcount={totalCount === null ? -1 : totalCount + 1}
        aria-busy={isFetchingNextPage}
        style={style}
        sx={tableSx}
      >
        <TableHead component="div" role="rowgroup" sx={headSx}>
          <TableRow component="div" role="row" aria-rowindex={1} sx={rowSx}>
            {columns.map((column) => (
              <TableCell
                key={column.id}
                component="div"
                role="columnheader"
                align={column.align}
                sx={cellSx}
              >
                {column.header}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody component="div" role="rowgroup" sx={groupSx}>
          {rows.map((row, index) => {
            const rowId = getRowId(row);
            return (
              <MemoGridRow
                key={rowId}
                row={row}
                rowId={rowId}
                rowIndex={index + 2}
                columns={columns}
                register={register}
              />
            );
          })}
          {isFetchingNextPage &&
            Array.from({ length: loadingRows }, (_, index) => (
              <TableRow
                key={`loading-${index}`}
                component="div"
                role="row"
                aria-busy="true"
                sx={rowSx}
              >
                {columns.map((column) => (
                  <TableCell key={column.id} component="div" role="gridcell" sx={cellSx}>
                    <SkeletonCell />
                  </TableCell>
                ))}
              </TableRow>
            ))}
        </TableBody>
      </Table>
      {rows.length === 0 && !isFetchingNextPage && empty}
      <Box ref={endRef} aria-hidden="true" sx={{ height: '1px' }} />
    </Box>
  );
}

const noop = () => undefined;
