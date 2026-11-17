# Schedule a trip

A widget of the Vulog back office to handle the scheduled bookings ("Schedule a trip") of a fleet, with their prepayment: the booking list by tab (Alert, Upcoming, Ongoing, Completed, Cancelled), the prepayment invoice and its refund, the credits, the pre-allocation of a vehicle and internal notes. Built with React and [MUI](https://mui.com) (7.3.6 or later). It calls the Vulog API with the token of the operator (`authFetch`) and keeps the state of each booking in the storage of the back office (`bo.storage`): no backend of its own.

**Status: foundation.** This version holds the tabs (empty for now), the installation settings, the data layer (API wrappers, query cache, storage contract), the business rules and the list primitives. The screens come next.

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
| `mapboxToken`               | string | yes      |                        | A **public** Mapbox token (`pk.…`), for the maps and the geocoding.            |
| `currency`                  | string | no       | currency of the fleet  | ISO 4217 code, when the fleet does not give one.                               |
| `timezone`                  | string | no       | time zone of the fleet | IANA time zone, when the fleet does not give one.                              |

`creditsRevokeHours` must not be greater than `refundFullHours`.

Prepayment amount: `round2(whole hours × 60 × dayRate / 1440 × ratio)`, at least `minimumAmount`. The operator can change it before charging; an amount above the computed one or below the minimum is warned about, not refused.

## Data kept in the back office

One document per booking, in the collection `bookings` of `bo.storage`, under the id of the booking. A server scheduler reads and writes the same documents, each side its own fields (`update` merges the first level). The contract is `src/storage/booking-state.ts` (`schemaVersion: 1`):

- **Created** at the first write of the widget (charge, pre-allocation, note), with `allocationProcessed: false`, so that the scheduler finds it by query.
- **No expiry while the booking is being handled.** The expiry (365 days, the most the storage takes) starts at the end of its cycle: refund with nothing to regularize, regularization, or the end written by the scheduler. Undoing a regularization removes it.
- **Charge claim**: before creating an invoice, the widget writes `chargeStartedAt` and `chargeStartedBy` over the version it read (`ifVersion`): two operators cannot charge the same booking twice.
- **Fields**: fleet, business profile flag, entity billed, charge claim, invoice and amounts (charged, computed, accepted warnings), invoice status cache, pre-allocated vehicle and plate, internal notes (500 characters), scheduler flags (allocation done, credits added, wallet, errors), credits revoked, refund date, regularization (amount left, pending flag, date, user id, note) and a journal of the 50 newest events.
- Every user of the host can read this storage: it holds user ids, never names, emails or secrets.

The browser keeps a cache of the reference data (models, services, cities, plates, geocoding) in `localStorage` for 24 hours. Names of customers and payment statuses stay in memory only.

## Scripts

| Script                   | What it does                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `npm run dev`            | Displays the widget in a fake back office, with mock data and settings (`dev` in `widget.config.ts`).             |
| `npm test`               | Runs the tests (Vitest).                                                                                          |
| `npm run typecheck`      | Type-checks.                                                                                                      |
| `npm run build`          | Type-checks, builds `dist/` with `index.js` and `widget.json`, and packs it into `schedule-a-trip-{version}.zip`. |
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

## How it works

The back office loads `index.js`, registers its default export (the element class) under a tag of its own, sets its API on the element (`vulogBo`) and inserts it in its content zone. The widget never calls `customElements.define`.

- `src/main.tsx` exports `toCustomElement(App)` of [`@vulog/bo-widget-react`](https://github.com/Vu-Log/bo-widget-sdk/tree/main/packages/bo-widget-react): React rendered in a shadow root, the MUI (Emotion) styles kept in it, MUI dialogs, menus and tooltips rendered in it too, a MUI theme built from the theme of the back office, and a clean unmount.
- `src/App.tsx` shows the header, the settings banner and the tabs, inside `WidgetQueryProvider` (TanStack Query, with the persisted cache of the reference data). It reads the back office with the hooks `useBoContext()`, `useAuthFetch()` and `useBoClient()`.
- `src/api/` calls the Vulog API with `authFetch` and the paths of the Vulog API reference. The routes `user/scheduleATrip/fleets/{fleetId}/bookingrequests/...` are the ones the back office calls for its own Schedule a trip page: they are not in the public reference yet.
- `src/domain/` holds the business rules as pure functions; `src/storage/booking-state.ts` the stored state of each booking.
- Keep MUI 7.3.6 or later: earlier versions trap the focus of a dialog outside a shadow root, so its text fields cannot be typed in.
- `connect` of [`@vulog/bo-widget-sdk`](https://github.com/Vu-Log/bo-widget-sdk/tree/main/packages/bo-widget-sdk) gives the client of the back office: `getContext()`, `getCurrentUser()`, `getSettings()`, `notify()`, `navigate()`, `on('fleetChanged')`… and `authFetch` to call the Vulog API (permission `apiInfo` in `widget.config.ts`):

  ```ts
  const response = await bo.authFetch(`fleetmanager/public/fleets/${fleetId}/vehicles`);
  ```

- The element fills the content zone (`:host` at 100 %), the root is a column, and only the main area scrolls (`flex: 1; min-height: 0; overflow: auto`). Never use `100vh` or `100vw`.
- The back office only sees the errors thrown synchronously when it inserts the element: the widget shows the others itself.
- The tests mount the element with a fake of the back office API (`src/main.test.tsx`), with an in-memory storage; `src/integration.test.tsx` wires the API, cache, storage and grid modules with only the edges faked.

The manifest (`widget.json`) is generated from `widget.config.ts` and `package.json`: name, permissions, menu, settings. See [`@vulog/bo-widget-vite`](https://github.com/Vu-Log/bo-widget-sdk/tree/main/packages/bo-widget-vite) for its fields and the fake back office.
