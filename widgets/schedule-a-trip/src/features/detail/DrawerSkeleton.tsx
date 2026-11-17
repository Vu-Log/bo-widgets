import { Box } from '@mui/material';
import { SkeletonCell } from '../../ui/SkeletonCell';

/** The drawer of a booking while its data or its chunk loads. */
export function DrawerSkeleton() {
  return (
    <Box sx={{ p: 2 }} aria-busy="true" data-lazy-fallback="">
      <SkeletonCell width="60%" />
      <SkeletonCell />
      <SkeletonCell />
    </Box>
  );
}
