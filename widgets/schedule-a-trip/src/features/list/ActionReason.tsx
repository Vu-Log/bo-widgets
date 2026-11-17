import { Tooltip } from '@mui/material';
import type { ReactElement } from 'react';
import type { BookingAction } from '../extensions';

/**
 * Whether an action cannot run: `disabled`, or a reason given (a reason implies `disabled`).
 *
 * @param action - The action.
 * @returns `true` when disabled.
 */
export const isActionDisabled = (action: BookingAction): boolean =>
  action.disabled === true || Boolean(action.disabledReason);

/**
 * Shows the reason of a disabled action as a tooltip of its button. A disabled button gets no
 * pointer event, so the tooltip is put on a wrapper.
 *
 * @param props - The action and its button.
 * @returns The button, wrapped when the action has a reason.
 */
export function WithDisabledReason({
  action,
  children,
}: {
  readonly action: BookingAction;
  readonly children: ReactElement;
}) {
  if (!action.disabledReason) return children;
  return (
    <Tooltip title={action.disabledReason}>
      <span data-disabled-reason={action.id} style={{ display: 'inline-flex' }}>
        {children}
      </span>
    </Tooltip>
  );
}
