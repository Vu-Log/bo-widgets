import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInWidget } from '../../test/render';
import { headerText, SortHeader } from './SortHeader';

describe('SortHeader', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => unmount?.());

  it('sorts ascending by a new field, then switches the direction', async () => {
    const onSort = vi.fn();
    const view = await renderInWidget(
      <>
        <SortHeader field="startDate" label="Start" sort={{ field: 'startDate', direction: 'ASC' }} onSort={onSort} />
        <SortHeader field="radius" label="Radius" sort={{ field: 'startDate', direction: 'ASC' }} onSort={onSort} />
      </>,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.querySelectorAll('[role="button"], button')).toHaveLength(2));
    const [start, radius] = [...view.container.querySelectorAll<HTMLElement>('[role="button"], button')];
    start?.click();
    radius?.click();
    expect(onSort.mock.calls).toEqual([
      [{ field: 'startDate', direction: 'DESC' }],
      [{ field: 'radius', direction: 'ASC' }],
    ]);
  });
});

describe('headerText', () => {
  it('reads a text, the label of a SortHeader, else the id', () => {
    expect(headerText('Model', 'model')).toBe('Model');
    expect(
      headerText(<SortHeader field="f" label="Start" sort={{ field: 'f', direction: 'ASC' }} onSort={() => undefined} />, 'start'),
    ).toBe('Start');
    expect(headerText(<b>x</b>, 'other')).toBe('other');
  });
});
