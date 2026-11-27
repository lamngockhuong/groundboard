# Contributing to groundboard

Thanks for helping. This page covers setting up a clone, the development loop, the checks a
pull request must pass, and how commits and releases work. What groundboard is and how to use
it are in the [README](README.md); the viewer's design rules are in [DESIGN.md](DESIGN.md).

## Set up

You need Node 24 or later and pnpm at the version pinned in `package.json`.

```sh
git clone https://github.com/lamngockhuong/groundboard.git
cd groundboard
corepack enable          # or, on Node 25+ without corepack: npm install -g pnpm@12.21.0
pnpm install
pnpm -r build            # the packages, then the viewer into packages/groundboard/dist
pnpm -C packages/groundboard exec playwright install --only-shell chromium   # once, for browser tests
git config core.hooksPath .githooks                                          # once, see "Before you push"
```

## Where things live

| Path                         | Contents                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `packages/schema`            | Board IR (Zod), validation, JSON Schema                                      |
| `packages/layout`            | Text measurement, elkjs layout, worker-thread runner                         |
| `packages/render-excalidraw` | `LaidOutBoard` to `.excalidraw` scene                                        |
| `packages/groundboard`       | The published package: pipeline, source check, CLI, MCP, HTTP server         |
| `apps/web`                   | The viewer (Vite, React, `@excalidraw/excalidraw`), bundled into the package |
| `plugins/groundboard`        | The Claude Code plugin and its skills; the repository is its own marketplace |
| `examples/fixtures`          | A small project with a screen atlas, used by the tests and by `pnpm dev`     |

Only `groundboard` is published; the other packages are private and bundled into it.

## Development loop

### The viewer

```sh
pnpm dev
```

This starts the built server (`groundboard serve --atlas`) on 127.0.0.1:8788 and the viewer
from source on <http://127.0.0.1:5173>, which forwards `/api`, `/healthz` and `/fonts` to the
server. Changes under `apps/web` show in the browser at once. Ctrl+C stops both.

By default the atlas is a scratch copy of `examples/fixtures`, removed when you stop, so tags
and layouts you edit in the viewer never change the files the tests read. To work on a real
project's atlas instead, point it there; edits are then written into that project:

```sh
pnpm dev --root ../my-app                         # atlas in ../my-app/.groundboard
pnpm dev --root ../my-app --atlas-dir docs/boards
```

With no atlas behind it (`pnpm -C apps/web dev` alone), the viewer shows the sample boards of
`examples/fixtures`, as the hosted editor does. The built viewer that ships in the package does
not carry them: they are bundled only when `import.meta.env.DEV` is true or the build sets
`VITE_GROUNDBOARD_HOSTED=1`, which `pnpm -C apps/web build:hosted` does for the site.

### The site and the hosted editor

`apps/site` is the home page of groundboard.ohnice.app, plain HTML and CSS with no build. The
`Pages` workflow puts it at the root and the hosted editor (`apps/web` built with
`build:hosted` into `dist-hosted/`) under `/editor/`, then deploys to GitHub Pages. The release
workflow runs it for every release. To deploy again, run it from the Actions tab and pick the
branch in "Use workflow from"; the `github-pages` environment accepts deploys from `main` only
unless its rules are changed. To look at the result locally:

```sh
pnpm -C apps/web build:hosted
mkdir -p /tmp/gb-site && cp -R apps/site/. /tmp/gb-site/ && cp -R apps/web/dist-hosted /tmp/gb-site/editor
npx serve /tmp/gb-site            # any static server
```

`GROUNDBOARD_DEV_PORT` changes the server's port. If a port is taken, the command stops instead
of picking another: stop the viewer or server left running on it. `pnpm -C apps/web dev` runs
the viewer alone, in front of a `groundboard serve` you start yourself on port 8787.

### The server, the CLI and the other packages

These run from the build. After changing `packages/*`, run `pnpm -r build` again, then restart
`pnpm dev` or the command you are trying. Running the CLI from a clone, registering the local
build as an MCP server and loading the plugin from a clone are described in the README under
[Run from source](README.md#run-from-source).

## Checks

A pull request runs these on Node 24 and 26 (`.github/workflows/ci.yml`); run them before
opening one:

```sh
pnpm lint                       # Biome; `pnpm format` fixes formatting
node scripts/check-plugin-version.mjs
pnpm -r typecheck
pnpm -r build
pnpm test                       # needs the build: end-to-end tests spawn the built CLI
pnpm test:browser               # needs the build: Chromium checks of the served viewer
node scripts/check-pack.mjs     # pack, inspect and smoke-test the npm tarball
```

While working, run the tests you touched first, for example
`pnpm exec vitest run apps/web/test/layers.test.ts`.

Add or update tests with the change: unit tests next to the code they cover
(`apps/web/test`, `packages/*/src/*.test.ts`), and a `*.browser.ts` test in
`packages/groundboard/test` when the change is only visible in a browser. Fix a failing check
rather than loosening it.

The viewer must reach nothing off the machine: no CDN, no font service, no analytics, no
external link in the canvas UI. `pnpm test:browser` checks this, so keep every asset local and
add no dependency that fetches at runtime.

## Commits and pull requests

- Branch from `main` and open a pull request against it; it is squash-merged.
- Write the pull request title as a [Conventional Commit](https://www.conventionalcommits.org/),
  since it becomes the commit on `main` and the changelog line: `feat: …`, `fix(web): …`,
  `docs: …`, `chore: …`, `test: …`. Describe the behaviour, not the files:
  "feat(web): switch the viewer between English, Japanese and Vietnamese".
- Keep a pull request to one change. Say how you checked it, including screenshots for
  anything visible in the viewer, in light and dark.
- User-facing text in the viewer lives in `apps/web/src/locales`: add every new key to `en.ts`,
  `ja.ts` and `vi.ts`; a test fails when a language lacks a key.
- Update the README or DESIGN.md when the change alters how something is used or looks.

### Before you push

`.githooks/pre-push` blocks a push whose commit messages or added lines contain a term from an
untracked denylist at `.git/info/denylist` (one term per line). Without that file it passes
silently. Never commit secrets, `.env` files or client material.

## Releases

Releases are automated with release-please and are not part of a contribution. The README's
[Releases](README.md#releases) section explains the flow, including why the plugin's pinned
version moves only after npm has the new version.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
