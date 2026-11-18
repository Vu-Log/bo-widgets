# AGENTS.md

Instructions for AI coding agents working on **Schedule a trip**, a widget of the Vulog back office (BO), built with React and MUI, through `@vulog/bo-widget-react`.

## Read first

- `node_modules/@vulog/bo-widget-sdk/AGENTS.md`: the contract between a widget and the BO (`connect`, requests, events, permissions, `BoError`, `authFetch`), versioned with the installed SDK. Follow it over anything you remember about other widget systems.
- `README.md`: scripts, publication, development against a real API.
- `widget.config.ts`: the manifest (`widget.json`) is generated from it and from `package.json`. See `node_modules/@vulog/bo-widget-vite/README.md` for its fields and the fake BO.

## Commands

| Command                  | When                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `npm run dev`            | Shows the widget in a fake BO with the mock data of `widget.config.ts` (`dev`).     |
| `npm test`               | After every change (Vitest).                                                        |
| `npm run build`          | Type-checks (`tsc`), builds `dist/` and packs `schedule-a-trip-<version>.zip`.      |
| `npx bo-widget validate` | Checks the zip of the current version with the rules the BO applies at publication. |

Before you say a change is done: `npm test` and `npm run build` pass.

## Rules for this project

- `src/main.tsx` exports `toCustomElement(App)`: keep it the default export, do not register the class. It renders React in a shadow root, keeps the Emotion styles and the MUI portals (Dialog, Menu, Popover, Tooltip, Select…) in it, and builds the MUI theme from the theme of the back office.
- Read the back office state with the hooks of `@vulog/bo-widget-react`: `useBoContext()`, `useCurrentUser()`, `useAuthFetch()`, `useBoTheme()`, `useBoRouter()`, `useBoClient()`. Do not call `connect` yourself. See `node_modules/@vulog/bo-widget-react/README.md`.
- Keep `@mui/material` 7.3.6 or later: earlier versions trap the focus of a dialog outside a shadow root.
- The hooks load the initial state and follow the events (`localeChanged`, `fleetChanged`, `themeChanged`…). Navigate with `useBoRouter().navigate`, show feedback with `useBoClient().notify({ message, severity })`: never `window.location`, `history` or `alert`.
- Do not set `container` on MUI portals and do not use `cssVariables` in the theme: its `:root` variables do not apply in a shadow root. Customize the theme with the `customizeTheme` option of `toCustomElement`.
- The BO registers the class under a tag it chooses: never call `customElements.define`, never register other elements globally, never assume the tag name.
- Fill the content zone: `:host` at 100 %, a column root, only the main area scrolls (`flex: 1; min-height: 0; overflow: auto`). Never use `100vh` or `100vw`.
- Keep every style in the shadow root: nothing in `document.head`, no CSS file in the bundle. A library CSS is imported with `?inline` and added to the shadow root once (as `injectMapboxCss` does).
- Heavy or rarely used UI is lazy: a drawer, a dialog, a wizard, a map, a language. Load it with `lazyModule` / `lazyComponent` (`src/ui/lazy.tsx`, a literal `import()`, declared at module scope) under a `LazyBoundary` (or `LazyDialogBoundary` for a dialog): a skeleton while it loads, an error with Retry (and Close for a dialog) when its chunk fails, logged with `bo.log.error`. Never import it statically from the shell too, or it stays in `shell` (the build says `INEFFECTIVE_DYNAMIC_IMPORT`). Preload what an operator is likely to open next (`preload`, `whenIdle`). Check the chunks of `dist/assets/` after `npm run build`.
- A request needing a permission (`apiInfo`, `accessToken`, `navigate`, `notify`, `storage`, `sharedStorage`) needs it in `permissions` of `widget.config.ts`.
- Mapbox GL JS (`mapbox-gl`) is imported only by `src/ui/map/MapboxMap.tsx`, in the lazy map chunk. Never hide the Mapbox logo or the attribution, on the interactive map or the static image (Mapbox terms). The token is the installer's public token (`pk.…`) from the settings, never one in the code.
- The bundle is public: no secret, no API key, no token in the code or in `widget.config.ts`. `.env.local` holds the developer's values and is never committed.
- Errors the BO cannot see (anything after the element is inserted) are shown by the widget itself, with a loading and an error state.

## Layout of `src/`

| Path                       | Holds                                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/`                     | One module per API domain: thin wrappers over `authFetch` that return an `ApiResult` (`{ ok, data }` or `{ ok: false, error }`), never throw. |
| `domain/`                  | Pure business rules (amount, refund policy, statuses, vehicles in range): no React, no I/O, 100 % covered.                                    |
| `storage/booking-state.ts` | The contract of the `bookings` collection of `bo.storage`, shared with a server scheduler.                                                    |
| `query/`                   | TanStack Query: client, persistence, query keys and query options.                                                                            |
| `features/`                | The booking section: `BookingSection`, the list (`list/`), the drawer (`detail/`), the `core`, `prepayment` and `write` features, `registry.tsx`, `extensions.ts`. |
| `ui/`                      | Primitives without business logic: `ListGrid`, `SkeletonCell`, `StaticMap`, `ConfigurationBanner`, the `IntersectionObserver` hooks, the lazy loading (`lazy.tsx`, `LazyBoundary.tsx`) and the map (`map/`: `MapView`, the lazy `MapboxMap` of Mapbox GL JS, its fallback to `StaticMap`). |
| `settings.ts`              | The installation settings, checked with zod.                                                                                                  |
| `features/prepayment/`     | The prepayment feature: charge with its claim, verification, retry, refund, regularization, internal notes, journal.                     |
| `i18n.ts`, `locales/`      | Translation (`useI18n().t`) and `Intl`/date-fns formatting; one flat JSON catalogue per language, and its pack `locales/<language>.ts` (catalogue and date-fns locale), a chunk loaded on demand (English is bundled). |
| `test/`                    | Test helpers only (and `setup.ts`, the `setupFiles` of Vitest: `vi.waitFor` waits up to 5 s by default): the fake BO (in-memory storage), the fake `IntersectionObserver`, `renderInWidget`, the fake Vulog API, `renderInSection`, the fake billing API (`fake-aima.ts`), a minimal host of a feature (`feature-host.tsx`). |

## Languages

The widget speaks 8 languages: English (source and fallback), German, French, Italian, Dutch, Spanish, Portuguese and Hungarian (`LANGUAGES` in `src/i18n.ts`). The language comes from the BO locale (`useBoContext().locale`, followed on `localeChanged`): the full locale, then its language, then English.

- **Every string shown to an operator goes through `useI18n().t('key', { param })`**: never a literal in a component. Error messages too: `apiErrorText(error)` gives the key of an API failure.
- **A new string is added to the 8 catalogues `src/locales/{en,de,fr,it,nl,es,pt,hu}.json` in the same change**, with a real translation: flat keys (`area.name`), the same keys and the same `{param}` placeholders as `en.json`. `src/i18n.test.tsx` fails otherwise, and the type check refuses a catalogue missing a key (`satisfies Catalogue` in `src/locales/<language>.ts`).
- Only English is in the main bundle: the other packs are loaded by `loadLanguage` (`LANGUAGE_LOADERS`, one literal `import()` per language, so one chunk per language), and `useI18n()` speaks English until the pack arrives. A test that expects another language awaits `loadLanguage(language)` first (or waits with `vi.waitFor`); `createI18n` and `translate` use the packs loaded so far.
- Keep the product name "Schedule a trip" untranslated. Keep UI wording short.
- Format numbers, amounts and dates with `formatNumber`, `formatCurrency` and `formatDate` of `useI18n()` (`Intl` and the date-fns locale), never by hand.
- The manifest labels (`menu.label`, each setting `label`) carry the 8 languages too: the test checks it.

## Data rules

- Build every query key with `queryKeys` (`query/keys.ts`). Only the roots of `PERSISTED_QUERY_ROOTS` (models, services, cities, plates, geocoding, fleet config) are written to `localStorage`: never a customer name, a payment status, a booking, a stored state or the settings. A new root is memory-only until it is added to that list, and `query/client.test.ts` checks it.
- A persisted query needs a `gcTime` at least `PERSIST_MAX_AGE_MS`, or it is never restored.
- Keep only the fields the widget needs from an API answer (`api/users.ts` keeps the names, the user name and the profile types and entities, never other personal data).
- A 403 is shown as "not allowed" (`apiErrorMessage`), not as a generic failure. Mutations are never retried.
- `bookings/{bookingId}`: read the document, then write a patch over it with `updateBookingState(collection, current, patch)` (always `ifVersion`; never `set` over an existing document). Create with `createBookingState` (`allocationProcessed: false`, no expiry). Start the 365-day expiry only at the end of a cycle with `startExpiry`, remove it with `stopExpiry`. Claim a charge with `claimCharge` before creating an invoice, and `releaseCharge` when the API refused it. Record an action by passing `events: withEvent(...)` in the patch of its own write. The journal is an audit trail only: a money step (charge accepted, refund, fees, credits revocation) is a first-level field written with its entry (`withMoneyEvents`, `storage/money-steps.ts`), and every guard, resume or decision reads the fields, never `events`. The widget never writes the scheduler fields (`SCHEDULER_FIELDS`), and every write is checked against the contract, rules between fields included. Raise `SCHEMA_VERSION` for any change of the contract: the scheduler reads it too.
- Branch on the `kind` of a `StorageFailure`: after `unknown-outcome`, read again before writing; after `rate-limited`, wait, never retry in a loop.
- Features: add what the list or the drawer shows as a `BookingFeature` (`features/extensions.ts`) registered in `features/registry.ts`, never inside `BookingSection`. Labels are final texts: build the feature with `t`. A row's `BookingContext` keeps its identity until its booking, state or customer changes: the grid memoizes the rows on it.
- Writes: a write that crosses the API and the storage is an operation of `features/write/operations.ts` (pure, tested with the fake BO): it undoes its first step when a later one fails, and reports what is left to check as warnings. Never put a vehicle back in service unless its reason still names the booking (`isHeldFor`).
- Stored state of a row: the query `queryKeys.bookingState(fleetId, bookingId)` is its source, seeded by one listing of the fleet (`fleetBookingStatesQueryOptions`). After a write, set that query with the document written.
- Lists: `useInfiniteQuery` with `bookingPagesQueryOptions`, rendered with `ListGrid` (divs in CSS grid with `content-visibility: auto`, never a `<table>`), with `isLoading` and `pagination` (pass `isFetchNextPageError`: the grid stops asking after a failed page and shows a retry). Load the customers page by page (one `users/list` call per page of bookings, with the ids not asked for yet), and any other extra data one query per cell, with `SkeletonCell` until it arrives (`onVisibleRowsChange` gives the visible rows when a call per row is needed). Every row is exactly `--row-height` high: keep a cell to two lines.

## Calling the Vulog API

Use `useAuthFetch()`, then `authFetch('<service path>/<route>')`, a path relative to the BO admin API (`.../boapi/proxy/`): never prefix it with `boapi/proxy/`, never add `Authorization` or `X-API-Key`. The widget needs the `apiInfo` permission.

To find an endpoint, its parameters and its response, use the **`aima-api` skill** of the SDK repository (`plugins/bo-widget/skills/aima-api` in <https://github.com/Vu-Log/bo-widget-sdk>, generated from the public API reference; a weekly job proposes an update): it gives the path to pass to `authFetch`. In Claude Code: `/plugin marketplace add Vu-Log/bo-widget-sdk`, then `/plugin install bo-widget@bo-widget-sdk`. Other agents: `npx skills add Vu-Log/bo-widget-sdk`. Never guess an endpoint: if you cannot find it, ask.

In `npm run dev` (mock mode), API calls are answered by `dev.responses` of `widget.config.ts`: add a response there for each endpoint the widget calls.

## Tests

`src/main.test.tsx` mounts the element with a fake of the BO API (an object with `getContext`, `on`, `off`… set as `vulogBo`). Extend it for every behaviour you add: nominal case, `BoError` from a request, an event changing the display, cleanup on removal. Stub `fetch` for `authFetch`. `src/integration.test.tsx` and `src/features/BookingSection.test.tsx` wire the real modules together with only the edges faked (`stubVulogApi` and `fleetApi` of `src/test/vulog-api.ts`): extend them when a feature crosses modules. Test values stay neutral (`FLEET-1`, `Jane Doe`): the repository is public.

The CI runner is slower than a laptop: tests have 15 s, hooks 30 s, and `vi.waitFor` 5 s by default (`src/test/setup.ts`). After a `vi.waitFor`, an assertion on data from another source (another query, a lazy chunk, an effect, the storage) goes in its own `vi.waitFor`, never bare.

## Documentation

<https://vu-log.github.io/bo-widget-sdk/> (`llms.txt` and `llms-full.txt` for agents).

## Money paths (prepayment feature)

- A money call (invoice, refund, fees, wallet) never runs without its document, and never without a write before it: the charge claim (`claimCharge`, with the amounts) before an invoice, the start of the step (`refundStartedAt`, `feeStartedAt`, `creditsRevocationStartedAt`, written with its journal entry by `withMoneyEvents`) before a refund step. Each later write is built again on the fresh document (`writeOver`), so a step someone else did meanwhile is refused.
- Only a clear refusal of the API (a 4xx, a request never sent: `isClearRefusal`) releases a claim. A lost answer, a 5xx or an unreadable answer is "to verify": search the invoice, never charge again.
- The steps of a refund are read back from the fields of the document (`refundProgress`), never from the journal; a refund stopped on the way resumes where it stopped. A refund or a fee call with an unknown outcome is "in doubt": never done again until an operator says it was not, at least 10 minutes after it started. The journal keeps these money entries (`MONEY_EVENT_TYPES`) when it is full: add a new money entry type there.
- The dialogs run the workflows through `guard` (an unexpected error is logged and shown, the dialog never stays busy) and log every money outcome that is not a plain success with `logOutcome`.
- The dialogs check the live data (settings, invoice status, refundable amount) before any call: the cached `invoiceStatus` of a document only drives the actions and filters of the list.
