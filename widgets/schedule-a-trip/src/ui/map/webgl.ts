/**
 * Whether the browser can draw with WebGL, which Mapbox GL JS needs (a disabled GPU, a virtual
 * machine, a privacy setting may turn it off).
 *
 * @returns `true` when a WebGL context can be created.
 */
export function hasWebGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
