import { Alert, Button, Dialog, DialogActions, DialogContent } from '@mui/material';
import { useBoClient } from '@vulog/bo-widget-react';
import { Component, Suspense, useCallback, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { describeError } from '../query/WidgetQueryProvider';
import { ChunkLoadError } from './lazy';
import { SkeletonCell } from './SkeletonCell';

interface BoundaryState {
  readonly caught: boolean;
  readonly error: unknown;
}

interface BoundaryProps {
  readonly children: ReactNode;
  readonly fallback: ReactNode;
  readonly renderError: (retry: () => void) => ReactNode;
  readonly onChunkError: (error: ChunkLoadError) => void;
}

/**
 * Catches the {@link ChunkLoadError} of the lazy components below it. Any other error goes on to
 * the boundary above: only a failed load has a Retry here.
 */
class ChunkErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { caught: false, error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { caught: true, error };
  }

  override componentDidCatch(error: unknown): void {
    if (error instanceof ChunkLoadError) this.props.onChunkError(error);
  }

  private readonly retry = () => {
    const { error } = this.state;
    if (error instanceof ChunkLoadError) error.forget();
    this.setState({ caught: false, error: null });
  };

  override render(): ReactNode {
    const { caught, error } = this.state;
    if (!caught) return <Suspense fallback={this.props.fallback}>{this.props.children}</Suspense>;
    // Not a failed load: the boundary above (or the BO) handles it, as without this boundary.
    if (!(error instanceof ChunkLoadError)) throw error;
    return this.props.renderError(this.retry);
  }
}

/** Props of {@link LazyBoundary}. */
export interface LazyBoundaryProps {
  readonly children: ReactNode;
  /** Shown while the chunk loads: a skeleton of what comes. */
  readonly fallback: ReactNode;
  /** Shown when the chunk cannot be loaded; {@link ChunkError} by default. */
  readonly renderError?: (retry: () => void) => ReactNode;
}

/**
 * The boundary of a lazy part of the widget: its skeleton while the chunk loads, then the part; when
 * the chunk cannot be loaded (network, CDN), the failure is logged with `bo.log.error` and an error
 * with a Retry, which runs the `import()` again, takes its place. Never a blank widget.
 *
 * @param props - The lazy part, its skeleton and its error state.
 * @returns The boundary.
 */
export function LazyBoundary({ children, fallback, renderError }: LazyBoundaryProps) {
  const bo = useBoClient();
  const onChunkError = useCallback(
    (error: ChunkLoadError) =>
      bo.log.error('A part of the widget could not be loaded', {
        chunk: error.chunk,
        ...describeError(error.cause),
      }),
    [bo],
  );
  return (
    <ChunkErrorBoundary
      fallback={fallback}
      renderError={renderError ?? ((retry) => <ChunkError onRetry={retry} />)}
      onChunkError={onChunkError}
    >
      {children}
    </ChunkErrorBoundary>
  );
}

/**
 * The error of a chunk that could not be loaded, with its Retry.
 *
 * @param props - What Retry does.
 * @returns The alert.
 */
export function ChunkError({ onRetry }: { readonly onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <Alert
      severity="error"
      role="alert"
      action={
        <Button color="inherit" size="small" onClick={onRetry}>
          {t('grid.retry')}
        </Button>
      }
    >
      {t('lazy.loadFailed')}
    </Alert>
  );
}

/**
 * The boundary of a lazy dialog: an open dialog with a skeleton while it loads, and with the error,
 * Retry and Close when it cannot be loaded, so that a failed chunk never leaves a stuck modal.
 *
 * @param props - The dialog and how to close it.
 * @returns The boundary.
 */
export function LazyDialogBoundary({
  children,
  onClose,
}: {
  readonly children: ReactNode;
  readonly onClose: () => void;
}) {
  return (
    <LazyBoundary
      fallback={<DialogShell onClose={onClose} busy />}
      renderError={(retry) => (
        <DialogShell onClose={onClose}>
          <ChunkError onRetry={retry} />
        </DialogShell>
      )}
    >
      {children}
    </LazyBoundary>
  );
}

/** A dialog while its content loads, or with the failure of its chunk. */
function DialogShell({
  onClose,
  busy = false,
  children,
}: {
  readonly onClose: () => void;
  readonly busy?: boolean;
  readonly children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose} aria-label={t('common.loading')}>
      <DialogContent aria-busy={busy} data-lazy-fallback={busy ? '' : undefined}>
        {busy ? (
          <>
            <SkeletonCell width="60%" />
            <SkeletonCell />
            <SkeletonCell />
          </>
        ) : (
          children
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('detail.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
