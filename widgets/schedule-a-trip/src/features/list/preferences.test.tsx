import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBo } from '../../test/fake-bo';
import { renderInWidget } from '../../test/render';
import {
  DEFAULT_PREFERENCES,
  isColumnShown,
  PREFERENCES_KEY,
  readPreferences,
  useListPreferences,
  withColumn,
} from './preferences';

const memory = (value: string | null) => ({
  getItem: vi.fn(() => value),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});

describe('readPreferences', () => {
  it('reads the saved preferences', () => {
    expect(readPreferences(memory('{"density":"compact","columns":["model"]}'))).toEqual({
      density: 'compact',
      columns: ['model'],
    });
  });

  it('gives the defaults without storage, or for what it cannot read', () => {
    expect(readPreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences(memory(null))).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences(memory('not json'))).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences(memory('{"density":"huge","columns":"x"}'))).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('isColumnShown and withColumn', () => {
  it('hides a column shown by default, and shows it again', () => {
    const hidden = withColumn([], 'model', false, false);
    expect(hidden).toEqual(['model']);
    expect(isColumnShown(hidden, 'model', false)).toBe(false);
    expect(withColumn(hidden, 'model', false, true)).toEqual([]);
  });

  it('shows a column hidden by default, and hides it again', () => {
    const shown = withColumn([], 'radius', true, true);
    expect(shown).toEqual(['!radius']);
    expect(isColumnShown(shown, 'radius', true)).toBe(true);
    expect(isColumnShown([], 'radius', true)).toBe(false);
    expect(withColumn(shown, 'radius', true, false)).toEqual([]);
  });
});

describe('useListPreferences', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => {
    unmount?.();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function Probe() {
    const [preferences, update] = useListPreferences();
    return (
      <button type="button" onClick={() => update((current) => ({ ...current, density: 'comfortable' }))}>
        {preferences.density}
      </button>
    );
  }

  it('saves a change in localStorage', async () => {
    const view = await renderInWidget(<Probe />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toBe('standard'));
    view.container.querySelector('button')?.click();
    await vi.waitFor(() => expect(view.container.textContent).toBe('comfortable'));
    expect(JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}')).toEqual({
      density: 'comfortable',
      columns: [],
    });
  });

  it('goes on and logs when the storage fails', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const bo = fakeBo();
    const view = await renderInWidget(<Probe />, bo.api);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.container.textContent).toBe('standard'));
    view.container.querySelector('button')?.click();
    await vi.waitFor(() => expect(view.container.textContent).toBe('comfortable'));
    await vi.waitFor(() => expect(bo.api.log.warn).toHaveBeenCalled());
  });
});
