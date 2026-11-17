import { Skeleton } from '@mui/material';

/**
 * The placeholder of a cell whose data comes from another request, shown until it arrives. Hidden
 * from screen readers: the row announces itself busy instead.
 *
 * @param props - `width` of the bar, in px or as a CSS length (80 % by default).
 * @returns The skeleton.
 */
export function SkeletonCell({ width = '80%' }: { readonly width?: number | string }) {
  return <Skeleton variant="text" width={width} aria-hidden="true" data-skeleton="" />;
}
