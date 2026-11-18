import { TableSortLabel } from '@mui/material';
import { isValidElement, type ReactNode } from 'react';
import type { BookingListSort } from '../../query/keys';

/** Props of {@link SortHeader}. */
export interface SortHeaderProps {
  readonly field: string;
  readonly label: string;
  readonly sort: BookingListSort;
  readonly onSort: (sort: BookingListSort) => void;
}

/**
 * The header of a column sorted by the API: a click sorts by it, ascending first, then switches
 * the direction.
 *
 * @param props - The field, its label, the current sort and its setter.
 * @returns The header.
 */
export function SortHeader({ field, label, sort, onSort }: SortHeaderProps) {
  const active = sort.field === field;
  return (
    <TableSortLabel
      active={active}
      direction={active ? (sort.direction === 'ASC' ? 'asc' : 'desc') : 'asc'}
      onClick={() =>
        onSort({ field, direction: active && sort.direction === 'ASC' ? 'DESC' : 'ASC' })
      }
    >
      {label}
    </TableSortLabel>
  );
}

/**
 * The text of a column header, for the column picker: the header itself when it is a text, the
 * label of a {@link SortHeader}, else the id of the column.
 *
 * @param header - The header of the column.
 * @param id - The id of the column.
 * @returns The text.
 */
export function headerText(header: ReactNode, id: string): string {
  if (typeof header === 'string') return header;
  if (isValidElement<SortHeaderProps>(header) && header.type === SortHeader) return header.props.label;
  return id;
}
