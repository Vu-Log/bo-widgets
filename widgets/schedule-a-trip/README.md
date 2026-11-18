# Schedule a trip

A widget of the Vulog back office to handle the scheduled bookings ("Schedule a trip") of a fleet, with their prepayment: the booking list by tab (Alert, Upcoming, Ongoing, Completed, Cancelled), the prepayment invoice and its refund, the credits, the pre-allocation of a vehicle and internal notes. Built with React and [MUI](https://mui.com) (7.3.6 or later). It calls the Vulog API with the token of the operator (`authFetch`) and keeps the state of each booking in the storage of the back office (`bo.storage`): no backend of its own.

**Status: booking section.** The five tabs list the bookings page by page, with the customer, the model and the vehicle of each row; a booking opens in a drawer (its URL is `{view}/{bookingId}`) with its lifecycle, its trip on a map, its vehicle and its customer. Bookings are created, edited, cancelled, allocated and pre-allocated from the widget. Bookings to prepay are charged, verified, retried, refunded and regularized from the list and the drawer (see Prepayment).

## The booking section

- **List**: KPI buttons (quick filters), the tabs Alert, Upcoming, Ongoing, Completed and Cancelled with their counts, a search (customer, plate, booking id; `/` focuses it), filter chips, the density and the columns (both kept in the browser), and a refresh. The rows of a tab load 50 at a time as you scroll; a filter the API cannot apply loads every page first, with the progress. The customers are read page by page: one call per page of 50 bookings, with the customers not read yet.
- **Ongoing and Completed** both read the `CONFIRMED` bookings: a booking is Ongoing while its trip is in progress (`fleetmanager/public/fleets/{fleetId}/book`), Completed once completed and no longer in progress. Ongoing reads them at once, Completed page by page, latest first.
- **Keyboard**: in the list, ↑/↓, Home and End move between the rows, Enter opens one; in the drawer, ↑/↓ open the previous or next booking, Escape closes it.
- **Map**: an interactive [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/) map (`src/ui/map/MapView.tsx`) in the drawer (the pickup point and its radius), the create and edit dialogs (click the map or drag the pin to move the pickup point) and the vehicle picker (the vehicles in and out of range, clustered when they overlap, the one hovered in the list highlighted on the map and the other way round), with the address from the Mapbox geocoding and the public token of the settings. Mapbox GL JS and its CSS are a chunk of their own, loaded the first time a map shows, the CSS added to the shadow root. Without WebGL, or when the map cannot be loaded, the widget shows the static view instead: a [Mapbox static image](https://docs.mapbox.com/api/maps/static-images/) with the radius and the markers drawn over it in SVG (`src/ui/StaticMap.tsx`). Without a token, or when Mapbox refuses it (401, 403), the map area explains what token to set (see Mapbox).
- **No stored data**: a booking the widget never wrote for has no document; one whose last activity is more than 365 days old shows **Archived data**, read only (the document may have expired).
- **Create** ("New booking", 3 steps, as the back office does): the customer (search of the back office) and one of their profiles (personal or business, neither inactive nor archived); the service (free floating, approved for the profile), the dates in the time zone of the fleet, the model (of the vehicles of the service, or any) and the pickup point (address search, map click or coordinates) with its radius; a summary with the notes.
- **Edit**: the dates, the notes, the pickup point and the radius, or the model (while no vehicle is allocated), of a booking to come. Only the fields changed are sent, always with the model (the API resets a missing model to "any").
- **Cancel** a booking to come, **allocate** a vehicle (refused while the customer has a trip in progress), **take it back**.
- **Vehicle picker**: a map and a list side by side, the available vehicles of the service and model in the radius, or the 10 closest outside it, by distance, with energy, range and mileage.
- **Pre-allocation**: the vehicle is put out of service until the start, its reason naming the booking (`Schedule a trip {bookingId}`), and recorded in the stored state (`preallocatedVehicleId`, `preallocatedPlate`, journal). Changing it puts the previous vehicle back in service if it is still held for the booking; removing it, allocating another vehicle or cancelling the booking does the same. A vehicle out of service for another reason since is left as it is, with a warning. When the stored state cannot be written, the vehicle is put back in service. Refused once the scheduler handled the booking (`allocationProcessed`). Setting or changing it waits for a paid prepayment or a business booking, as before: the action stays in the menu, disabled with the reason; removing it is always allowed.
- **Extension point**: everything the list and the drawer show comes from the features of `src/features/registry.tsx` (`BookingFeature` in `src/features/extensions.ts`), in this order: `core`, `prepayment`, `write`. Columns (`hiddenByDefault` for those shown from the Columns menu only: id, creation date, radius, coordinates, alert reason, internal notes; the actions column stays pinned at the end of the rows), a primary action per row (the first feature that gives one wins: "Prepay", "Verify the prepayment", "Retry payment", "Refund" or "Mark as regularized" before "Pre-allocate" or "Allocate"), menu actions (a disabled action may give its `disabledReason`, shown as a tooltip or under the menu item), filters (`needsAllPages` when the API cannot apply them; a filter may bring its own bookings with `filterSources`, as "To regularize" does from the storage, its KPI counting them), KPIs, detail cards (by `order`: Actions 5, Trip 10, Vehicle 20, Customer 30, Payment 40, Internal notes 50, Journal 90) and a `Host` per feature rendered once (dialogs).

## Prepayment

- **Charge**: a dialog prefilled with the computed amount (or a required amount with its duration estimated, without a planned return date). Warnings never block: "Prepay anyway", then a confirmation. The charge is claimed in the document before the invoice is created (`POST user/billing/fleets/{fleetId}/invoices/product`, notes `Schedule a trip {bookingId} – N h`, `originId` the operator). No prepayment for a business profile.
- **Prepayment to verify**: when the answer of the invoice is lost, the claim stays; the widget searches the invoice (`GET .../invoices`, created since the claim, exact amount, then customer, product and notes) and attaches it, or offers "No invoice found, unlock" once the claim is 10 minutes old, never after a failed or incomplete search nor when the API accepted the invoice.
- **Retry payment**: only for an invoice `REFUSED` or `ERROR` (`POST .../invoices/{invoiceId}/retry-payment`); any other status is explained.
- **Refund** (Cancelled tab, paid invoice): the refundable amount (`GET .../refundableAmount`, `POST .../refund`), the cancellation fees (price of `cancellationFeesProductId`, `GET user/fleets/{fleetId}/products/{productId}`) and the revocation of the credits (`GET .../wallet/entity/{entityId}`, `PATCH .../wallets/{walletId}`) by the thresholds of the settings. Each step is recorded as it is done: a refund stopped on the way resumes where it stopped, and a refund or fees with an unknown outcome are never done again until an operator says they were not (10 minutes after they started). Fees the credits left do not cover are to regularize by hand: "Mark as regularized" (with a note), which can be undone.
- **Internal notes** (500 characters) and a **journal** of every action, newest first.
- Every money action is disabled, with the reason (the settings to fix and their problem), while the settings are invalid; a 403 says which action the role of the operator does not allow. Without stored data, the refund (Cancelled tab) and, on archived data, the internal notes are shown disabled with the reason.
- **Invoice status**: the status of the prepayment invoice read from the API is written back to the stored state (`invoiceStatus`, `invoiceStatusFetchedAt`) when it changed, so that the filters and the pre-allocation follow a payment that settles. The refresh of the list reads the invoices and the bookings to regularize again.

## Settings

Filled in by an administrator at installation, in **Configuration > Widgets**, and read with `getSettings()`. They are readable by the code of the widget, which runs in the browser: never put a secret in them. When a value is invalid, the widget shows a "Configuration incomplete" banner and disables the prepayment actions.

| Key                         | Type   | Required | Default                | What it is                                                                     |
| --------------------------- | ------ | -------- | ---------------------- | ------------------------------------------------------------------------------ |
| `prepaymentProductId`       | string | yes      |                        | Id (uuid) of the product invoiced for the prepayment.                          |
| `cancellationFeesProductId` | string | yes      |                        | Id (uuid) of the product invoiced for the cancellation fees.                   |
| `dayRate`                   | number | yes      |                        | Price of a day, > 0.                                                           |
| `ratio`                     | number | yes      |                        | Coefficient applied to the day rate, > 0.                                      |
| `minimumAmount`             | number | yes      |                        | Lowest prepayment amount computed, > 0.                                        |
| `refundFullHours`           | number | no       | `24`                   | Cancelled at least this many hours before the start: refunded without fees.    |
| `creditsRevokeHours`        | number | no       | `1`                    | Cancelled less than this many hours before the start: the credits are revoked. |
| `vehicleSearchRadius`       | number | no       | `500`                  | Default radius, in meters, of the vehicle search.                              |
| `mapboxToken`               | string | yes      |                        | A **public** Mapbox token (`pk.…`) restricted to the back-office URL, for the maps and the geocoding (see Mapbox). |
| `currency`                  | string | no       | currency of the fleet  | ISO 4217 code, when the fleet does not give one.                               |
| `timezone`                  | string | no       | time zone of the fleet | IANA time zone, when the fleet does not give one.                              |

`creditsRevokeHours` must not be greater than `refundFullHours`.

Prepayment amount: `round2(whole hours × 60 × dayRate / 1440 × ratio)`, at least `minimumAmount`. The operator can change it before charging; an amount above the computed one or below the minimum is warned about, not refused.

## Languages

English, German, French, Italian, Dutch, Spanish, Portuguese and Hungarian. The widget follows the language of the back office: the full locale (`pt_BR`), then its language (`pt`), then English. Numbers, amounts and dates use the BO locale (`Intl` and date-fns). The menu entry and the settings are labelled in the same 8 languages.

Only English is in the main bundle. Each other language is a chunk of its own (`assets/de-[hash].js`…: its catalogue and its date-fns locale, from `src/locales/<language>.ts`), loaded when the back office speaks it (`loadLanguage` in `src/i18n.ts`) and again on `localeChanged`. Until it arrives (a few KB, usually before the first page of the list), the widget shows in English: the shell and the requests start at once instead of waiting behind a skeleton. When it cannot be loaded, the widget stays in English with a banner and a Retry, and logs it (`bo.log.error`).

To add a text: add its key to the 8 catalogues `src/locales/{en,de,fr,it,nl,es,pt,hu}.json` (flat keys, `{param}` placeholders, English is the source), then use `useI18n().t('key', { param })`. The type check fails when a catalogue misses a key (`satisfies Catalogue` in `src/locales/<language>.ts`); the tests fail when one misses a key, has an extra one, or changes a placeholder.

## Bundle

`index.js` only imports `assets/shell-[hash].js`: everything the list needs at once (React, MUI, TanStack Query, zod, the shell, the list and its columns, the features and their rules, the settings, the English texts). What is heavy or rarely used is a chunk of its own, loaded with `import()` the first time it shows, with a skeleton meanwhile:

| Chunk                                         | Holds                                                         | Loaded                                                      |
| --------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| `DrawerBody`, `core-cards`, `prepayment-cards` | The content of the detail drawer and its cards               | On a row hovered or focused, when the browser is idle, or on open |
| `prepayment-dialogs`                          | Charge, verify, retry, refund, regularize, notes              | When the browser is idle, or on open                        |
| `CreateBooking`, `write-dialogs`, `VehiclePicker` | The create wizard, the edit and confirm dialogs, the vehicle picker | On open                                            |
| `MapView`, `MapboxMap`                        | The map with its static fallback; Mapbox GL JS with its CSS   | `MapView` with the cards and dialogs that show a map; `MapboxMap` when a map shows with a token and WebGL |
| `de`, `fr`, `it`, `nl`, `es`, `pt`, `hu`      | A language: its texts and its date-fns locale                 | When the back office speaks it                              |

- A chunk that cannot be loaded (network, CDN) shows an error with a Retry (a dialog keeps its Close), logged with `bo.log.error`: never a blank widget. The map falls back to the static view instead.
- `src/ui/lazy.tsx` (`lazyModule`, `lazyComponent`, `whenIdle`) and `src/ui/LazyBoundary.tsx` hold the mechanism: a lazy component can be preloaded, and a failed load is forgotten on Retry (`React.lazy` keeps it).
- No CSS file: the styles stay in the shadow root (Emotion), the CSS of Mapbox GL JS too (`?inline`).
- `vite.config.ts` names the chunks (`assets/[name]-[hash].js`), groups what `index.js` needs in `shell`, and minifies the whitespace that library mode keeps.
- The zip holds `index.js`, `widget.json` and `assets/`: `npm run build` packs every file of `dist/`.

## Mapbox

The maps and the address search use [Mapbox](https://www.mapbox.com). The widget needs the installer's **own Mapbox account** and a **public token** (`pk.…`) of that account in the `mapboxToken` setting. Never use a secret token (`sk.…`): the settings validation refuses it.

- **Restrict the token** to the back-office URL(s) in the Mapbox account ([URL restrictions](https://docs.mapbox.com/accounts/guides/tokens/#url-restrictions)): the settings are readable by every user of the back office and by the browser.
- **Billing**: the use of Mapbox (map loads of Mapbox GL JS, Static Images and Geocoding requests) is billed by Mapbox to the owner of the token. See the [Mapbox pricing](https://www.mapbox.com/pricing) and the [Mapbox terms of service](https://www.mapbox.com/legal/tos).
- **License**: Mapbox GL JS v2 and later is distributed under the Mapbox Terms of Service: it is proprietary, not open source, not covered by the MIT license of this repository, and may only be used with Mapbox services.
- **Attribution**: the Mapbox logo and the attribution (© Mapbox, © OpenStreetMap) must stay visible on the maps, the interactive one and the static image. Do not hide them with CSS.
- When the token is missing or invalid, or when Mapbox refuses it (401: wrong or revoked token; 403: URL not allowed by the token), the map area says: "The map needs a valid Mapbox public token restricted to this back office. Set it in Configuration > Widgets."

## Third-party

The widget bundles open-source packages (React, MUI, TanStack Query, date-fns, zod… under their licenses) and Mapbox GL JS, under the Mapbox Terms of Service (see Mapbox).

## Data kept in the back office

One document per booking, in the collection `bookings` of `bo.storage`, under the id of the booking. A server scheduler reads and writes the same documents, each side its own fields (`update` merges the first level). The contract is `src/storage/booking-state.ts` (`schemaVersion: 1`):

- **Created** at the first write of the widget (charge, pre-allocation, note), with `allocationProcessed: false`, so that the scheduler finds it by query.
- **No expiry while the booking is being handled.** The expiry (365 days, the most the storage takes) starts at the end of its cycle: refund with nothing to regularize, regularization, or the end written by the scheduler. Undoing a regularization removes it.
- **Charge claim**: before creating an invoice, the widget writes `chargeStartedAt` and `chargeStartedBy` over the version it read (`ifVersion`): two operators cannot charge the same booking twice.
- **Fields**: fleet, business profile flag, entity billed, charge claim, invoice and amounts (charged, computed, accepted warnings), invoice status cache, pre-allocated vehicle and plate, internal notes (500 characters), scheduler flags (allocation done, credits added, wallet, errors), credits revoked, refund date, regularization (amount left, pending flag, date, user id, note), the money steps below, and a journal of the 50 newest events.
- **The journal (`events`) is an audit trail only.** Every money step is a first-level field, written in the same write as its journal entry (`src/storage/money-steps.ts`); every guard, resume and decision reads the fields, never the journal.

### Money steps

| Field | Type | Set when |
| --- | --- | --- |
| `chargeAcceptedAt` | ISO date \| null | The API accepted the invoice of the current claim without giving its id: the claim is never unlocked. Cleared by a new claim and by a release. |
| `refundStartedAt`, `refundStartedBy` | ISO date, user id | The refund call is about to be sent. |
| `refundAmount` | number \| null | Amount of the refund call. |
| `refundOutcome` | `in-doubt` \| `confirmed` \| `released` | `in-doubt` from the start until the refund is recorded (`confirmed`), refused or said not done (`released`). |
| `refundDecidedAt`, `refundDecidedBy` | ISO date, user id | An operator decided a refund in doubt (the last decision on the step, kept when it starts again). |
| `feeStartedAt` | ISO date | The cancellation fee invoice is about to be created. |
| `feeAmount` | number \| null | Fees started, charged or confirmed. |
| `walletBalanceBeforeFee` | number \| null | Wallet balance read before the fees. |
| `feeInvoiceId`, `feeChargedAt` | string, ISO date | The fee invoice the API created. |
| `feeOutcome` | `in-doubt` \| `charged` \| `confirmed` \| `skipped` \| `released` | `in-doubt` from the start; `confirmed` and `released` may be an operator's decision. |
| `feeDecidedAt`, `feeDecidedBy` | ISO date, user id | An operator decided fees in doubt (the last decision, kept when they start again). |
| `creditsRevocationStartedAt`, `creditsRevocationBalance` | ISO date, number | The wallet is about to be emptied; the balance recorded before. |
| `creditsRevocationSkippedAt` | ISO date | No wallet to empty. |
| `creditsRevoked` | boolean | The wallet was emptied. |
| `refundCompletedAt` | ISO date | Refund, fees and revocation are done; cleared when a refund starts again. |

A step `in-doubt` (a lost answer) is never done again until an operator decides it, at least 10 minutes after it started; a refund or fees started without an outcome are read as in doubt. The contract refuses a write that breaks a rule between these fields: a step started without its outcome, or in doubt without its start; fees `charged` or a fee invoice without `feeChargedAt`; a decision without its author; `chargeAcceptedAt` without a claim. A claim with `chargeAcceptedAt` is never released.

### Rules for the server scheduler

- It writes only its own fields (`allocationProcessed`, `creditsAdded`, `walletId`, `schedulerErrors`) with `update` over the version it read, and documents with `schemaVersion: 1`.
- **Credits are granted only once `invoiceId` is set and the invoice is `PAID`**: `chargeAmount` is written with the claim, before the invoice exists, and a claim may be released.
- **No credits once a refund started**: never grant them when `refundStartedAt`, `refundedAt` or `creditsRevocationSkippedAt` is set (a partial refund may leave the invoice `PAID`).
- It never writes the money steps (the refund, fees and credits revocation fields above), the charge claim nor the regularization.
- Every user of the host can read this storage: it holds user ids, never names, emails or secrets.

The browser keeps a cache of the reference data (models, services, cities, plates, geocoding) in `localStorage` for 24 hours. Names of customers, payment statuses and the addresses of the pickup points stay in memory only.

## Scripts

| Script                   | What it does                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `npm run dev`            | Displays the widget in a fake back office, with mock data and settings (`dev` in `widget.config.ts`).             |
| `npm test`               | Runs the tests (Vitest).                                                                                          |
| `npm run typecheck`      | Type-checks.                                                                                                      |
| `npm run build`          | Type-checks, builds `dist/` (`index.js`, `widget.json`, the chunks of `assets/`), and packs it into `schedule-a-trip-{version}.zip`. |
| `npx bo-widget validate` | Checks the zip of the current version with the rules the back office applies.                                     |

## Publish

1. Raise the version in `package.json`: the back office only accepts a version greater than those already published.
2. `npm run build`.
3. In the back office: **Configuration > Widgets > Publish a version**, then drop the zip.

`npx bo-widget validate` checks a zip with the rules the back office applies. In this repository, the CI at the root (`.github/workflows/ci.yml`) tests and builds every widget and keeps their zips as an artifact.

## Develop against a real API

In mock mode, the fake back office answers the Vulog API calls with the `dev.responses` of `widget.config.ts`. To call the API of a Vulog environment instead, put the host of its back office in `.env.local` (never commit it), then paste a token of your session in that back office:

```bash
# .env.local
BO_WIDGET_HOST=bo.example.com
```

```bash
pbpaste | npx bo-widget dev --token -
```

Or log in to that back office once, in a Chrome that the dev server opens, and let it follow your session, without pasting a new token when it expires (Chrome and Node.js 22 or later):

```bash
npx bo-widget dev --login
```

The fake back office keeps the neutral fleet and settings of `dev` in `widget.config.ts`. To use those of the real back office, set them in `.env.local` or on the command line, never in `widget.config.ts` (the repository is public):

```bash
# .env.local
BO_WIDGET_FLEET_ID=MY-FLEET
BO_WIDGET_SETTINGS={"prepaymentProductId":"…","dayRate":120,"ratio":1.2,"minimumAmount":10}
```

```bash
BO_WIDGET_HOST=bo.example.com BO_WIDGET_FLEET_ID=MY-FLEET npx bo-widget dev --login
```

`BO_WIDGET_SETTINGS` is a JSON object merged over `dev.settings` (`dev-env.ts`). The data storage stays the in-memory one of the fake back office, empty at start, but the Vulog API calls are real: on a production back office, every action that writes (prepayment, refund, allocation, cancellation, pre-allocation) writes in production.

## How it works

The back office loads `index.js`, registers its default export (the element class) under a tag of its own, sets its API on the element (`vulogBo`) and inserts it in its content zone. The widget never calls `customElements.define`.

- `src/main.tsx` exports `toCustomElement(App)` of [`@vulog/bo-widget-react`](https://github.com/Vu-Log/bo-widget-sdk/tree/main/packages/bo-widget-react): React rendered in a shadow root, the MUI (Emotion) styles kept in it, MUI dialogs, menus and tooltips rendered in it too, a MUI theme built from the theme of the back office, and a clean unmount.
- `src/App.tsx` shows the settings banner and the booking section (`src/features/BookingSection.tsx`), inside `WidgetQueryProvider` (TanStack Query, with the persisted cache of the reference data). It reads the back office with the hooks `useBoContext()`, `useAuthFetch()` and `useBoClient()`.
- `src/api/` calls the Vulog API with `authFetch` and the paths of the Vulog API reference. The routes `user/scheduleATrip/fleets/{fleetId}/bookingrequests/...` are the ones the back office calls for its own Schedule a trip page: they are not in the public reference yet.
- `src/domain/` holds the business rules as pure functions; `src/storage/booking-state.ts` the stored state of each booking.
- `src/features/` holds the booking section: the list (`list/`), the detail drawer (`detail/`), the core feature (`core/`: columns, cards, filters) and the registry of the features.
- Keep MUI 7.3.6 or later: earlier versions trap the focus of a dialog outside a shadow root, so its text fields cannot be typed in.
- `connect` of [`@vulog/bo-widget-sdk`](https://github.com/Vu-Log/bo-widget-sdk/tree/main/packages/bo-widget-sdk) gives the client of the back office: `getContext()`, `getCurrentUser()`, `getSettings()`, `notify()`, `navigate()`, `on('fleetChanged')`… and `authFetch` to call the Vulog API (permission `apiInfo` in `widget.config.ts`):

  ```ts
  const response = await bo.authFetch(`fleetmanager/public/fleets/${fleetId}/vehicles`);
  ```

- The element fills the content zone (`:host` at 100 %), the root is a column, and only the main area scrolls (`flex: 1; min-height: 0; overflow: auto`). Never use `100vh` or `100vw`.
- The back office only sees the errors thrown synchronously when it inserts the element: the widget shows the others itself.
- The tests mount the element with a fake of the back office API (`src/main.test.tsx`), with an in-memory storage; `src/integration.test.tsx` wires the API, cache, storage and grid modules with only the edges faked.

The manifest (`widget.json`) is generated from `widget.config.ts` and `package.json`: name, permissions, menu, settings. See [`@vulog/bo-widget-vite`](https://github.com/Vu-Log/bo-widget-sdk/tree/main/packages/bo-widget-vite) for its fields and the fake back office.
