let probed: boolean | undefined;

/**
 * Whether the browser can draw with WebGL, which Mapbox GL JS needs (a disabled GPU, a virtual
 * machine, a privacy setting may turn it off). Probed once per page, its context released at once:
 * browsers drop the oldest context past a limit, which could be the one of a map.
 *
 * @returns `true` when a WebGL context can be created.
 */
export function hasWebGl(): boolean {
  probed ??= probe();
  return probed;
}

function probe(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    return context !== null;
  } catch {
    // A browser that refuses the probe (a privacy setting) has no usable WebGL for the map.
    return false;
  }
}
