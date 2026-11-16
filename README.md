# Vulog back office widgets

The widgets Vulog builds for its back office, with [`@vulog/bo-widget-sdk`](https://github.com/Vu-Log/bo-widget-sdk). Each one is a complete project you can start yours from.

## Widgets

| Widget                            | Stack       | What it does                    |
| --------------------------------- | ----------- | ------------------------------- |
| [`sat-admin`](widgets/sat-admin/) | React + MUI | Being migrated: no content yet. |

## Start your widget from one of ours

Every folder of `widgets/` is a standalone project: it depends only on the packages of the SDK published on npm, never on another widget.

- **Use this template** on GitHub creates your own repository, which can be private. A fork of this public repository is public.
- Or copy the folder of a widget, then in it: `npm install`, `npm run dev`.
- To start from scratch: `npm create @vulog/bo-widget`.

Then rename the widget: `name` in `package.json` (its id in the back office) and `name` and `menu` in `widget.config.ts`.

## Develop

Node.js 22.13 or later. The widgets are npm workspaces: install once, at the root.

| Script              | What it does                                                             |
| ------------------- | ------------------------------------------------------------------------ |
| `npm install`       | Installs the dependencies of every widget.                               |
| `npm test`          | Runs the tests of every widget (Vitest).                                 |
| `npm run typecheck` | Type-checks every widget.                                                |
| `npm run build`     | Builds every widget and packs it into `widgets/<id>/<id>-<version>.zip`. |

In a widget: `npm run dev -w <id>` displays it in a fake back office. The README of each widget explains how to publish it and how to develop against a real API.

The CI (`.github/workflows/ci.yml`) tests and builds every widget on each push and pull request, and keeps the zips as an artifact.

## Add a widget

```bash
cd widgets
npm create @vulog/bo-widget@latest <id>
rm -r <id>/.github <id>/.gitlab-ci.yml   # the CI is at the root
cd .. && npm install
```

Keep it standalone: no import from another widget, no shared internal package. Code that several widgets need belongs in the SDK.

## License

[MIT](LICENSE)
