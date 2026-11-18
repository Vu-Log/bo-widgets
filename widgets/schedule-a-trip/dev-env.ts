/**
 * Values of the fake back office (`npm run dev`, `npx bo-widget dev --login`) taken from the environment or from
 * `.env.local`, so that the code shared in this public repository keeps neutral values: the fleet of a real back
 * office, and its installation settings.
 *
 * - `BO_WIDGET_FLEET_ID`: replaces `dev.context.fleetId`.
 * - `BO_WIDGET_SETTINGS`: a JSON object merged over `dev.settings`, e.g. `{"dayRate":120,"ratio":1.2}`.
 */
export interface DevOverrides {
  readonly fleetId?: string;
  readonly settings?: Readonly<Record<string, unknown>>;
}

/**
 * Reads the overrides of the fake back office.
 *
 * @param env - The `BO_WIDGET_*` variables (Vite's `loadEnv`).
 * @returns The fleet and the settings set, nothing for an empty or missing variable.
 * @throws {Error} When `BO_WIDGET_SETTINGS` is not a JSON object.
 */
export function devOverrides(env: Readonly<Record<string, string | undefined>>): DevOverrides {
  const fleetId = env.BO_WIDGET_FLEET_ID?.trim();
  const rawSettings = env.BO_WIDGET_SETTINGS?.trim();
  return {
    ...(fleetId ? { fleetId } : {}),
    ...(rawSettings ? { settings: parseSettings(rawSettings) } : {}),
  };
}

function parseSettings(raw: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`BO_WIDGET_SETTINGS must be a JSON object: ${(error as Error).message}`, { cause: error });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('BO_WIDGET_SETTINGS must be a JSON object, e.g. {"dayRate":120}');
  }
  return value as Record<string, unknown>;
}
