import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeObservers, installFakeIntersectionObserver } from '../test/intersection-observer';
import { renderInWidget } from '../test/render';
import { ListGrid, type ListGridColumn, type ListGridPagination } from './ListGrid';

interface Row {
  id: string;
  name: string;
}

const renders = vi.fn();
const columns: ListGridColumn<Row>[] = [
  { id: 'id', header: 'Id', width: '120px', render: (row) => row.id },
  {
    id: 'name',
    header: 'Name',
    width: 'minmax(160px, 1fr)',
    align: 'right',
    render: (row) => {
      renders(row.id);
      return row.name;
    },
  },
];
const rows: Row[] = [
  { id: 'r1', name: 'One' },
  { id: 'r2', name: 'Two' },
];
const getRowId = (row: Row) => row.id;

let unmount: (() => void) | undefined;

beforeEach(() => {
  installFakeIntersectionObserver();
  renders.mockClear();
});
afterEach(() => {
  unmount?.();
  unmount = undefined;
  vi.unstubAllGlobals();
});

const styles = () =>
  [...document.querySelectorAll('style')].map((style) => style.textContent).join('\n');

describe('ListGrid', () => {
  it('renders a grid of divs with the ARIA roles of a grid', async () => {
    const view = await renderInWidget(
      <ListGrid
        label="Bookings"
        columns={columns}
        rows={rows}
        getRowId={getRowId}
        totalCount={412}
      />,
    );
    unmount = view.unmount;
    await vi.waitFor(() =>
      expect(view.container.querySelectorAll('[role="gridcell"]')).toHaveLength(4),
    );

    const grid = view.container.querySelector('[role="grid"]');
    expect(grid?.tagName).toBe('DIV');
    expect(grid?.getAttribute('aria-label')).toBe('Bookings');
    expect(grid?.getAttribute('aria-rowcount')).toBe('413');
    expect(view.container.querySelector('table, tr, td, th')).toBeNull();
    expect(
      [...view.container.querySelectorAll('[role="columnheader"]')].map((cell) => cell.textContent),
    ).toEqual(['Id', 'Name']);
    const bodyRows = view.container.querySelectorAll('[data-row-id]');
    expect([...bodyRows].map((row) => row.getAttribute('aria-rowindex'))).toEqual(['2', '3']);
    expect(bodyRows[1]?.textContent).toBe('r2Two');
  });

  it('shares the column tracks and the row height through CSS variables', async () => {
    const view = await renderInWidget(
      <ListGrid
        label="Bookings"
        columns={columns}
        rows={rows}
        getRowId={getRowId}
        rowHeight={36}
      />,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.querySelector('[role="grid"]')).not.toBeNull());

    const grid = view.container.querySelector<HTMLElement>('[role="grid"]');
    expect(grid?.style.getPropertyValue('--grid-columns')).toBe('120px minmax(160px, 1fr)');
    expect(grid?.style.getPropertyValue('--row-height')).toBe('36px');
    expect(grid?.getAttribute('aria-rowcount')).toBe('-1');
  });

  it('lets the browser skip the rows off screen', async () => {
    const view = await renderInWidget(
      <ListGrid label="Bookings" columns={columns} rows={rows} getRowId={getRowId} />,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.querySelector('[data-row-id]')).not.toBeNull());

    expect(styles()).toContain('content-visibility:auto');
    expect(styles()).toContain('contain-intrinsic-size:auto var(--row-height)');
    expect(styles()).toContain('grid-template-columns:var(--grid-columns)');
  });

  it('renders again only the rows whose object changed', async () => {
    const view = await renderInWidget(
      <ListGrid label="Bookings" columns={columns} rows={rows} getRowId={getRowId} />,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(renders).toHaveBeenCalledTimes(2));
    renders.mockClear();

    const updated = [rows[0]!, { id: 'r2', name: 'Deux' }];
    view.rerender(
      <ListGrid label="Bookings" columns={columns} rows={updated} getRowId={getRowId} />,
    );

    await vi.waitFor(() => expect(view.container.textContent).toContain('Deux'));
    expect(renders.mock.calls).toEqual([['r2']]);
  });

  it('reports the visible rows, within 20 rows of the area by default', async () => {
    const onVisibleRowsChange = vi.fn();
    const view = await renderInWidget(
      <ListGrid
        label="Bookings"
        columns={columns}
        rows={rows}
        getRowId={getRowId}
        onVisibleRowsChange={onVisibleRowsChange}
      />,
    );
    unmount = view.unmount;
    await vi.waitFor(() =>
      expect(activeObservers().some((observer) => observer.targets.size === 2)).toBe(true),
    );
    const observer = activeObservers().find((candidate) => candidate.targets.size === 2);
    expect(observer?.options.rootMargin).toBe(`${20 * 48}px 0px`);

    observer?.report([view.container.querySelector('[data-row-id="r2"]')!], true);

    expect(onVisibleRowsChange).toHaveBeenLastCalledWith(new Set(['r2']));
  });

  const pagination = (overrides: Partial<ListGridPagination> = {}): ListGridPagination => ({
    hasNextPage: true,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
    ...overrides,
  });
  const endObserver = () =>
    activeObservers().find((observer) => observer.options.rootMargin?.startsWith('0px 0px'));

  it('asks for the next page near the end, and shows skeleton rows while it loads', async () => {
    const paging = pagination();
    const props = { label: 'Bookings', columns, rows, getRowId };
    const view = await renderInWidget(<ListGrid {...props} pagination={paging} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(activeObservers()).toHaveLength(2));
    endObserver()?.report(endObserver()!.targets, true);
    expect(paging.fetchNextPage).toHaveBeenCalledTimes(1);

    view.rerender(<ListGrid {...props} pagination={{ ...paging, isFetchingNextPage: true }} />);

    await vi.waitFor(() =>
      expect(view.container.querySelectorAll('[data-skeleton]')).toHaveLength(6),
    );
    expect(view.container.querySelector('[role="grid"]')?.getAttribute('aria-busy')).toBe('true');
    expect(activeObservers()).toHaveLength(1);

    // Once the page has loaded, a new observer asks again if the end is still in view.
    view.rerender(<ListGrid {...props} pagination={paging} />);
    await vi.waitFor(() => expect(endObserver()).toBeDefined());
    endObserver()?.report(endObserver()!.targets, true);
    expect(paging.fetchNextPage).toHaveBeenCalledTimes(2);
  });

  it('stops asking after a failed page, and lets the operator retry', async () => {
    const paging = pagination({ isFetchNextPageError: true });
    const view = await renderInWidget(
      <ListGrid
        label="Bookings"
        columns={columns}
        rows={rows}
        getRowId={getRowId}
        pagination={paging}
        labels={{ nextPageError: 'Next rows failed.', retry: 'Try again' }}
      />,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toContain('Next rows failed.'));
    expect(endObserver()).toBeUndefined();

    const retry = [...view.container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Try again',
    );
    retry?.click();
    expect(paging.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('does not ask for more without a next page', async () => {
    const view = await renderInWidget(
      <ListGrid
        label="Bookings"
        columns={columns}
        rows={rows}
        getRowId={getRowId}
        pagination={pagination({ hasNextPage: false })}
      />,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(activeObservers()).toHaveLength(1));
    expect(endObserver()).toBeUndefined();
  });

  it('shows a row once when two pages hold it', async () => {
    const view = await renderInWidget(
      <ListGrid
        label="Bookings"
        columns={columns}
        rows={[...rows, { id: 'r2', name: 'Two again' }]}
        getRowId={getRowId}
      />,
    );
    unmount = view.unmount;
    await vi.waitFor(() =>
      expect(view.container.querySelectorAll('[data-row-id]')).toHaveLength(2),
    );
    expect(view.container.textContent).not.toContain('Two again');
  });

  it('shows the empty state without rows', async () => {
    const view = await renderInWidget(
      <ListGrid
        label="Bookings"
        columns={columns}
        rows={[]}
        getRowId={getRowId}
        empty={<p>No booking</p>}
      />,
    );
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toContain('No booking'));
    expect(view.container.querySelectorAll('[role="gridcell"]')).toHaveLength(0);
  });

  it('hides the empty state while a page loads', async () => {
    const view = await renderInWidget(
      <ListGrid
        label="Bookings"
        columns={columns}
        rows={[]}
        getRowId={getRowId}
        pagination={pagination({ isFetchingNextPage: true })}
        loadingRows={1}
        empty={<p>No booking</p>}
      />,
    );
    unmount = view.unmount;
    await vi.waitFor(() =>
      expect(view.container.querySelectorAll('[data-skeleton]')).toHaveLength(2),
    );
    expect(view.container.textContent).not.toContain('No booking');
  });

  it('shows skeleton rows instead of the empty state on the first load', async () => {
    const view = await renderInWidget(
      <ListGrid
        label="Bookings"
        columns={columns}
        rows={[]}
        getRowId={getRowId}
        isLoading
        empty={<p>No booking</p>}
      />,
    );
    unmount = view.unmount;
    await vi.waitFor(() =>
      expect(view.container.querySelectorAll('[data-skeleton]')).toHaveLength(6),
    );
    expect(view.container.textContent).not.toContain('No booking');
  });
});

describe('ListGrid with onRowActivate', () => {
  const threeRows: Row[] = [...rows, { id: 'r3', name: 'Three' }];
  const withAction: ListGridColumn<Row>[] = [
    ...columns,
    { id: 'act', header: '', width: '80px', render: (row) => <button type="button">{`act-${row.id}`}</button> },
  ];
  const render = async (onRowActivate = vi.fn(), activeRowId: string | null = null) => {
    const view = await renderInWidget(
      <ListGrid
        label="Bookings"
        columns={withAction}
        rows={threeRows}
        getRowId={getRowId}
        onRowActivate={onRowActivate}
        activeRowId={activeRowId}
      />,
    );
    unmount = view.unmount;
    const row = (id: string) => view.container.querySelector<HTMLElement>(`[data-row-id="${id}"]`)!;
    await vi.waitFor(() => expect(row('r3')).not.toBeNull());
    return { ...view, row, onRowActivate };
  };
  const key = (element: HTMLElement, name: string) =>
    element.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

  it('makes the rows one tab stop, the first one by default', async () => {
    const { row } = await render();
    expect([row('r1').tabIndex, row('r2').tabIndex, row('r3').tabIndex]).toEqual([0, -1, -1]);
    expect(row('r1').getAttribute('aria-selected')).toBe('false');
  });

  it('marks the active row as selected and as the tab stop', async () => {
    const { row } = await render(vi.fn(), 'r2');
    expect(row('r2').getAttribute('aria-selected')).toBe('true');
    expect(row('r2').tabIndex).toBe(0);
    expect(row('r1').tabIndex).toBe(-1);
  });

  it('activates a row on a click, but not on a click of one of its buttons', async () => {
    const { row, onRowActivate } = await render();
    row('r2').querySelector('[role="gridcell"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onRowActivate).toHaveBeenCalledWith('r2');
    row('r3').querySelector('button')?.click();
    expect(onRowActivate).toHaveBeenCalledTimes(1);
  });

  it('moves the focus with the arrows, Home and End, and activates with Enter or Space', async () => {
    const { row, onRowActivate } = await render();
    row('r1').focus();
    key(row('r1'), 'ArrowDown');
    expect(document.activeElement).toBe(row('r2'));
    await vi.waitFor(() => expect(row('r2').tabIndex).toBe(0));
    key(row('r2'), 'End');
    expect(document.activeElement).toBe(row('r3'));
    key(row('r3'), 'ArrowDown');
    expect(document.activeElement).toBe(row('r3'));
    key(row('r3'), 'Home');
    expect(document.activeElement).toBe(row('r1'));
    key(row('r1'), 'ArrowUp');
    expect(document.activeElement).toBe(row('r1'));
    key(row('r1'), 'Enter');
    key(row('r1'), ' ');
    expect(onRowActivate.mock.calls).toEqual([['r1'], ['r1']]);
  });

  it('leaves the keys of a control inside a row alone', async () => {
    const { row, onRowActivate } = await render();
    const button = row('r1').querySelector('button')!;
    button.focus();
    key(button, 'ArrowDown');
    key(button, 'Enter');
    expect(document.activeElement).toBe(button);
    expect(onRowActivate).not.toHaveBeenCalled();
  });

  it('keeps the rows plain without onRowActivate', async () => {
    const view = await renderInWidget(<ListGrid label="Bookings" columns={columns} rows={rows} getRowId={getRowId} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.querySelector('[data-row-id="r1"]')).not.toBeNull());
    const row = view.container.querySelector('[data-row-id="r1"]')!;
    expect(row.hasAttribute('tabindex')).toBe(false);
    expect(row.hasAttribute('aria-selected')).toBe(false);
  });
});
