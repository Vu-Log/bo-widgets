# AGENTS.md

Instructions for AI coding agents working on **bo-widgets**: the widgets of the Vulog back office (BO), built with `@vulog/bo-widget-sdk`.

## Layout

- `widgets/<id>/`: one widget per folder, an npm workspace. Its own `AGENTS.md` holds the rules of its stack: read it before changing the widget.
- `.github/workflows/ci.yml`: tests and builds every widget. The widgets have no CI of their own.

## Commands

Run them at the root. `-w <id>` restricts one to a widget.

| Command               | When                                                 |
| --------------------- | ---------------------------------------------------- |
| `npm install`         | Once, at the root: there is one `package-lock.json`. |
| `npm test`            | After every change (Vitest).                         |
| `npm run typecheck`   | After every change.                                  |
| `npm run build`       | Builds and packs `widgets/<id>/<id>-<version>.zip`.  |
| `npm run dev -w <id>` | Shows a widget in a fake BO with its mock data.      |

Before you say a change is done: `npm test`, `npm run typecheck` and `npm run build` pass.

## Rules for this repository

- Clients copy a widget to start theirs: every widget stays standalone. No import from another widget, no shared internal package, no path outside its folder. It depends on the SDK packages published on npm (`@vulog/bo-widget-*`), with a semver range.
- Code that several widgets need goes to the SDK (<https://github.com/Vu-Log/bo-widget-sdk>), not here.
- No secret, no API key, no token, no client-specific value in the code: the repository and the bundles are public. `.env.local` is never committed.
- Add a widget with `npm create @vulog/bo-widget@latest <id>` in `widgets/`, then remove its `.github` and `.gitlab-ci.yml`, and list it in `README.md`.
- Major versions of the dependencies (React, MUI, Vite, Vitest, TypeScript…) follow the templates of the SDK (`npm create @vulog/bo-widget`): Dependabot ignores them, and they are aligned by hand when the SDK moves.
- Raise the `version` of a widget in its `package.json` before publishing it: the BO only accepts a greater version.
- Keep `index.js` small: heavy or rarely used UI (drawers, dialogs, wizards, maps, the languages other than English) is loaded on demand with `import()`, with a loading state and a Retry when its chunk fails. Never write CSS to `document.head`: every style stays in the shadow root of the widget.
