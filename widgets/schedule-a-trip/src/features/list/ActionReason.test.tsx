import { Button } from '@mui/material';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInWidget } from '../../test/render';
import type { BookingAction } from '../extensions';
import { isActionDisabled, WithDisabledReason } from './ActionReason';

const action = (overrides: Partial<BookingAction> = {}): BookingAction => ({
  id: 'a',
  label: 'Act',
  run: () => undefined,
  ...overrides,
});

describe('isActionDisabled', () => {
  it('is false for a plain action', () => {
    expect(isActionDisabled(action())).toBe(false);
  });

  it('is true when disabled, or when a reason is given', () => {
    expect(isActionDisabled(action({ disabled: true }))).toBe(true);
    expect(isActionDisabled(action({ disabledReason: 'Why' }))).toBe(true);
  });

  it('ignores an empty reason', () => {
    expect(isActionDisabled(action({ disabledReason: '' }))).toBe(false);
  });
});

describe('WithDisabledReason', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => unmount?.());

  it('renders the button alone without a reason', async () => {
    const view = await renderInWidget(
      <WithDisabledReason action={action()}>
        <Button>Act</Button>
      </WithDisabledReason>,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.querySelector('button')?.textContent).toBe('Act'));
    expect(view.container.querySelector('[data-disabled-reason]')).toBeNull();
  });

  it('wraps a disabled button with its reason as a tooltip', async () => {
    const view = await renderInWidget(
      <WithDisabledReason action={action({ disabledReason: 'Settings to fix' })}>
        <Button disabled>Act</Button>
      </WithDisabledReason>,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.querySelector('[data-disabled-reason="a"]')).not.toBeNull());
    const wrapper = view.container.querySelector('[data-disabled-reason="a"]');
    expect(wrapper?.getAttribute('aria-label')).toBe('Settings to fix');
    expect(wrapper?.querySelector('button')?.disabled).toBe(true);
  });
});
