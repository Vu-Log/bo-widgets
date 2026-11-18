/**
 * Why the interactive map cannot be shown:
 * - `webgl`: the browser has no WebGL;
 * - `token`: Mapbox refused the token (401: wrong or revoked token; 403: the token is not allowed on
 *   the URL of this back office);
 * - `load`: the map library, its style or its chunk could not be loaded.
 */
export type MapFailure =
  | { readonly kind: 'webgl' }
  | { readonly kind: 'token'; readonly status: 401 | 403 }
  | { readonly kind: 'load'; readonly error: unknown };
