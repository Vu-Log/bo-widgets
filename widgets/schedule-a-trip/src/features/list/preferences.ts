import { useBoClient } from '@vulog/bo-widget-react';
import { useCallback, useMemo, useState } from 'react';
import { z } from 'zod';
import { browserStorage, safeStorage, type KeyValueStorage } from '../../query/client';
import { describeError } from '../../query/WidgetQueryProvider';

/** Row heights of the list, in px. */
export const DENSITIES = { compact: 36, standard: 48, comfortable: 56 } as const;
/** A density of the list. */
export type Density = keyof typeof DENSITIES;

/** The columns the operator changed: each list holds column ids, the two lists never share one. */
export interface ColumnChoices {
  /** Columns shown by default that the operator hid. */
  readonly hidden: readonly string[];
  /** Columns hidden by default that the operator showed. */
  readonly shown: readonly string[];
}

/** What the list remembers for the operator, in the browser: nothing personal. */
export interface ListPreferences {
  readonly density: Density;
  readonly columns: ColumnChoices;
}

/** Key of the preferences in `localStorage`. */
export const PREFERENCES_KEY = 'schedule-a-trip:list-preferences:v2';

const ids = z.array(z.string()).max(200).catch([]);
const preferencesSchema = z.object({
  density: z.enum(Object.keys(DENSITIES) as [Density, ...Density[]]).catch('standard'),
  columns: z.object({ hidden: ids, shown: ids }).catch({ hidden: [], shown: [] }),
});

/** Default preferences. */
export const DEFAULT_PREFERENCES: ListPreferences = {
  density: 'standard',
  columns: { hidden: [], shown: [] },
};

/**
 * Reads the preferences; anything unreadable gives the defaults.
 *
 * @param storage - The browser storage, `null` when there is none.
 * @returns The preferences.
 */
export function readPreferences(storage: KeyValueStorage | null): ListPreferences {
  const raw = storage?.getItem(PREFERENCES_KEY);
  if (!raw) return DEFAULT_PREFERENCES;
  try {
    const parsed = preferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_PREFERENCES;
  } catch (error) {
    if (error instanceof SyntaxError) return DEFAULT_PREFERENCES;
    throw error;
  }
}

/**
 * Whether a column is shown: a column hidden by default once the operator showed it, any other
 * until the operator hid it.
 *
 * @param columns - The choices of the operator.
 * @param id - The id of the column.
 * @param hiddenByDefault - Whether the column starts hidden.
 * @returns `true` when shown.
 */
export const isColumnShown = (columns: ColumnChoices, id: string, hiddenByDefault: boolean) =>
  hiddenByDefault ? columns.shown.includes(id) : !columns.hidden.includes(id);

/**
 * Shows or hides a column: records the choice only when it differs from the default.
 *
 * @param columns - The choices of the operator.
 * @param id - The id of the column.
 * @param hiddenByDefault - Whether the column starts hidden.
 * @param shown - Whether to show it.
 * @returns The new choices.
 */
export function withColumn(
  columns: ColumnChoices,
  id: string,
  hiddenByDefault: boolean,
  shown: boolean,
): ColumnChoices {
  const hidden = columns.hidden.filter((column) => column !== id);
  const shownIds = columns.shown.filter((column) => column !== id);
  if (hiddenByDefault && shown) shownIds.push(id);
  if (!hiddenByDefault && !shown) hidden.push(id);
  return { hidden, shown: shownIds };
}

/**
 * The preferences of the list, kept in `localStorage` (a failure of the storage is logged and the
 * list goes on with the defaults).
 *
 * @returns The preferences and their setter.
 */
export function useListPreferences(): readonly [
  ListPreferences,
  (update: (current: ListPreferences) => ListPreferences) => void,
] {
  const bo = useBoClient();
  const storage = useMemo(() => {
    const onError = (operation: string, error: unknown) =>
      bo.log.warn('List preferences: browser storage failed', { operation, ...describeError(error) });
    return safeStorage(browserStorage(onError), onError);
  }, [bo]);
  const [preferences, setPreferences] = useState(() => readPreferences(storage));
  const update = useCallback(
    (change: (current: ListPreferences) => ListPreferences) =>
      setPreferences((current) => {
        const next = change(current);
        storage?.setItem(PREFERENCES_KEY, JSON.stringify(next));
        return next;
      }),
    [storage],
  );
  return [preferences, update] as const;
}
