import { useBoClient } from '@vulog/bo-widget-react';
import { useCallback, useMemo, useState } from 'react';
import { z } from 'zod';
import { browserStorage, safeStorage, type KeyValueStorage } from '../../query/client';
import { describeError } from '../../query/WidgetQueryProvider';

/** Row heights of the list, in px. */
export const DENSITIES = { compact: 36, standard: 48, comfortable: 56 } as const;
/** A density of the list. */
export type Density = keyof typeof DENSITIES;

/** What the list remembers for the operator, in the browser: nothing personal. */
export interface ListPreferences {
  readonly density: Density;
  /** Ids of the columns the operator hid, or showed among those hidden by default (`!id`). */
  readonly columns: readonly string[];
}

/** Key of the preferences in `localStorage`. */
export const PREFERENCES_KEY = 'schedule-a-trip:list-preferences:v1';

const preferencesSchema = z.object({
  density: z.enum(['compact', 'standard', 'comfortable']).catch('standard'),
  columns: z.array(z.string()).max(200).catch([]),
});

/** Default preferences. */
export const DEFAULT_PREFERENCES: ListPreferences = { density: 'standard', columns: [] };

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
 * Whether a column is shown: a column hidden by default shows once listed as `!id`, any other hides
 * once listed as `id`.
 *
 * @param columns - `columns` of the preferences.
 * @param id - The id of the column.
 * @param hiddenByDefault - Whether the column starts hidden.
 * @returns `true` when shown.
 */
export const isColumnShown = (columns: readonly string[], id: string, hiddenByDefault: boolean) =>
  hiddenByDefault ? columns.includes(`!${id}`) : !columns.includes(id);

/**
 * Shows or hides a column in the preferences.
 *
 * @param columns - `columns` of the preferences.
 * @param id - The id of the column.
 * @param hiddenByDefault - Whether the column starts hidden.
 * @param shown - Whether to show it.
 * @returns The new list.
 */
export function withColumn(
  columns: readonly string[],
  id: string,
  hiddenByDefault: boolean,
  shown: boolean,
): string[] {
  const entry = hiddenByDefault ? `!${id}` : id;
  const others = columns.filter((column) => column !== entry);
  return shown === hiddenByDefault ? [...others, entry] : others;
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
