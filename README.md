# groundboard

Turn a question about a codebase into an editable Excalidraw board whose every claim cites
the `file:line` it rests on, with the quoted text checked against the file.

You ask "why can a checkout be declined after the card was authorized?". An LLM (your
Claude Code session, or any MCP client) reads the code and writes a **board IR**: nodes,
edges, groups and quoted sources. groundboard validates the IR, checks every quote against
the cited lines, lays the graph out with [elkjs](https://github.com/kieler/elkjs) and renders
an `.excalidraw` scene: a flow or state diagram, causes, rejected options, decisions and open
questions, each labelled with its citations.

groundboard itself never calls an LLM and needs no API key. Nothing leaves your machine
unless you run the server.

To run it from a clone instead of the published package, see [Run from source](#run-from-source).

## Use it from Claude Code

```text
/plugin marketplace add lamngockhuong/groundboard
/plugin install groundboard@groundboard
```

Then ask, in any repository:

```text
/groundboard:board why does a packed order need a restock before a refund?
```

The skill reads the code, writes `.groundboard/<slug>.board.json`, renders
`.groundboard/<slug>.excalidraw` with the source check on, and reports the answer with its
key citations. Open the `.excalidraw` file on [excalidraw.com](https://excalidraw.com), in the
VS Code Excalidraw extension, or with `npx groundboard serve`. Commit the `*.board.json` files
so the whole team can open them (see [Screen atlas](#screen-atlas)); the `.excalidraw` files
can be generated again, so committing them is the team's choice.

The plugin starts its MCP server with `npx -y groundboard@<pinned version> mcp`, so the first
start downloads the package (about 5 s on a cold npm cache) and needs network access.

## Screen atlas

A screen atlas maps every screen of a web or mobile app: a wireframe of each screen whose
elements are tied to the handler that runs and the line that navigates, linked to the flow
boards that pass through them. Someone new clicks the "Pay" button and sees the screen that
holds it, the flows through it and the code behind it.

Build it from Claude Code with the plugin:

```text
/groundboard:atlas web                       # .groundboard/overview-web.board.json
/groundboard:screen web:checkout <figma-url> # .groundboard/web--checkout.board.json
/groundboard:screen mobile:cart ~/shots/cart.png
/groundboard:api orders                      # .groundboard/api--orders.board.json
/groundboard:db                              # .groundboard/overview-db.board.json
/groundboard:batch                           # .groundboard/overview-batch.board.json
```

`/groundboard:atlas` reads the router and draws every screen and every navigation call.
`/groundboard:screen` draws one screen from a Figma frame, a client mockup, screenshots, or the code,
and cites each control's handler or marks it unresolved with who must answer. Screens are named
by refs such as `web:checkout` and `web:checkout/pay-button`; a flow board that sets `ref` on a
node links to them.

`/groundboard:api` reads the route declarations (Express, Hono, NestJS, Next.js route handlers,
FastAPI, Django, Laravel, Rails, Spring), or before the code an OpenAPI file, and draws one board
per resource: a card of its endpoints, one row per `METHOD /path`, each citing its route. A
resource defines `api:orders` and an endpoint `api:orders/post` (the slug comes from the method
and path, so a skill and a check name it alike). On a screen board, a control that calls an
endpoint gets a `calls` edge to that ref, drawn as a numbered tag; a double click on the tag
opens the resource's board on the endpoint. The sidebar lists API boards in their own group.
`/groundboard:db` reads migrations and models (SQL, Prisma, Drizzle, TypeORM, Sequelize,
Knex, Alembic and Django, Laravel, Rails, Ent and GORM), never a live database, and draws the
tables as cards of column rows (`name  type  PK FK NULL UQ`) with foreign keys between them
(`references`, labelled with their columns and cardinality). A table defines `db:orders` and
each column `db:orders/email` (camelCase and snake_case name one column); endpoints and steps
that query a table get `reads` and `writes` edges to it. Selecting a column shows its own
source and the boards that point at it, and `atlas check --baseline` reports a column another
board relied on that a new run dropped.
`/groundboard:batch` finds the background jobs (BullMQ, Sidekiq, Laravel queues and scheduler,
Celery and beat, node-cron, Spring `@Scheduled`, Hangfire, crontab, Kubernetes CronJob, Cloud
Scheduler and EventBridge declared in the repository) and draws each as a card of what starts it
(`cron 0 2 * * *`, `queue: receipts`, `event: order.paid`, `manual`) and its retries, grouped by
trigger. A job defines `batch:send-receipt`; an endpoint, a step or another job that puts it on
its queue gets an `enqueues` edge, and the job gets `reads` and `writes` to the tables it
touches. A schedule must be a cron expression of 5 or 6 fields. From the "Pay" button a double
click follows `calls` to `POST /orders`, then `writes` to the `orders` table and `enqueues` to
the `send-receipt` job.
Refs now come in five namespaces, `web`, `mobile`, `api`, `db` and `batch`, and `atlas check`
reports a dangling or doubly defined ref in any of them, as the viewer's list of opened boards
does.

On a screen drawn from Figma, each element also cites the Figma layer it was built from, and the
skill caches an image of the frame in `.groundboard/.cache/figma/` (never committed; the cache
holds its own `.gitignore`). The viewer then shows the design beside the wireframe, with the
wireframe's boxes, handler dots and numbered tags drawn over it; selecting a box shows the same
sources as the element. The toolbar's Design button hides them. The skill writes each cache
entry with `groundboard figma entry`, which records a hash of the frame's layer outline and of
its pixels; on a later run it checks them again, and the image's caption says "design changed
since fetch" when either differs.

A screen that shows mutually exclusive states at one URL (wizard steps, loading / error /
success, a dialog opened by state) is drawn as one frame per state: each state is a `screen`
node with `stateOf` naming the screen and no ref of its own, and `transition` edges citing the
line that changes the state join the frames. The main path runs left to right and branches sit
on a second row. A worked example is in
[examples/fixtures/states](examples/fixtures/states/.groundboard).

Commit `.groundboard/*.board.json`. Never commit screenshots: the skill only reads them and
writes no image or image path into a board. Take screenshots with a test account; the skill
replaces names, emails, amounts and order numbers with placeholders, and groundboard warns about
text that looks like an email, a phone or card number or a local path.

Check the atlas, in CI or before committing (exit 3 on a dangling ref, a duplicate definition
or a board whose quotes no longer match the files):

```sh
npx groundboard atlas check                    # .groundboard/ against the current directory
npx groundboard atlas check --require code     # also fail on any claim not backed by code
npx groundboard atlas check --baseline <dir>   # also fail on an id or ref missing since <dir>
```

For each board it prints how many claims (screens, interactive elements, grounded nodes and
navigations) are backed by code, by the specification only, or unresolved:
`grounding: code 12, spec 30, none 4`. `--require spec` fails only on unresolved claims.

Browse it: everyone on the team runs, in the repository,

```sh
npx groundboard serve --atlas          # http://127.0.0.1:8787
```

The viewer lists the boards in a sidebar, and Ctrl K (Cmd K) jumps to a board, a node of the open
board or a ref. Selecting an element or an arrow shows its sources and every board where its ref
appears, and double-clicking the tag or line of a link to another screen opens that screen's
board; a link to `#/board/<name>?node=<id>` opens that board with that node selected. A board
whose code changed is still shown, marked stale, with a warning on each citation that changed. `serve` reads no files
without `--atlas`; with it, only `*.board.json` in the atlas directory, the cited files
under the root and the cached Figma images under `<atlas>/.cache/figma/` (at most 8 MB per image
and 32 MB per board; `?references=0` leaves them out), and on an address other than loopback it refuses to start unless both
`GROUNDBOARD_TOKEN` and `GROUNDBOARD_ALLOWED_HOSTS` are set.

Boards with `tags` are grouped by tag in the sidebar, with a chip per tag to filter by. On
127.0.0.1 the toolbar also edits the tags of the open board: the server writes the `tags`
field of that board's file and nothing else, so the change goes through git like any other.
An exported atlas and a server on any other address show tags but do not change them. The
Layers menu hides arrows, ref tags, marks or the legend to declutter a board.

Selecting a node runs dashes along the arrows into and out of it, in the direction of the
flow, and lights the nodes at their ends; Settings has a switch to run every arrow. "Present"
reveals the board one level of its graph at a time, starting from the nodes nothing points
to: `→` and `←` step, Space plays or pauses (1 to 5 seconds a step), Esc leaves and puts the
board back exactly as it was. Both work on an exported atlas too, and both keep still under
`prefers-reduced-motion`.

A worked example is in [examples/fixtures/.groundboard](examples/fixtures/.groundboard): try
`npx groundboard serve --atlas --root examples/fixtures --atlas-dir examples/fixtures/.groundboard`.

### From the first day of a project

The atlas does not need code. Before any is written, the skills build the overview, the screen
boards and the flow boards from what the project has: requirement documents in the repository,
the Figma file and its prototype links, and the client's mockups. Every claim then cites a
specification source, and the boards say so: spec-only claims are drawn dotted with a "spec"
tag, and the viewer shows "Spec only" next to their sources.

```text
/groundboard:atlas web                                  # screens and flows from docs/ and Figma
/groundboard:screen web:signup ~/Downloads/signup.png   # a screen from the client's mockup
/groundboard:board how should signup work, from the requirements?
```

- **Requirements in the repository** are cited as `doc` sources (file, line and quote), checked
  like code: editing a cited requirement makes the board stale.
- **A document outside the repository** (a Google Doc, a wiki page) is best copied as Markdown
  into `docs/requirements/`, with its original URL and the date at the top, and cited as `doc`.
  When that is not possible it is cited as a `link`, which is never fetched or checked; a link
  must be `https:` and may not carry a token or a signed query.
- **Mockups**: committing them is the project's choice. A committed mockup is cited with its path
  and groundboard checks that the file exists; one kept elsewhere is cited by its label and can
  back a screen's layout, but not what a control does.

groundboard itself still reads nothing outside the repository and calls no network.

### When the code arrives

Run the same skills again. They update the boards in place: every id and ref stays, the code
source is added next to the requirement it implements, and where the code does something other
than the specification they describe the code and add a question naming who decides. Before
changing anything they copy `.groundboard/` to `.groundboard-baseline/`, and afterwards
`atlas check --baseline .groundboard-baseline` proves that no id or ref was lost.

Read the progress in `atlas check` (or the viewer's list, which shows `code · spec · none` for
each board that is not fully backed by code), and turn on `atlas check --require code` in CI when
the team is ready. If you edit boards by hand, take the same baseline copy first.

A worked example of both stages is in [examples/fixtures/lifecycle](examples/fixtures/lifecycle):
`spec/` holds the requirements, a mockup and the boards built from them, and `code/` the same
boards after the code arrived.

## Use it from the command line

```sh
npx groundboard render board.json --check-sources .     # writes board.excalidraw
npx groundboard render board.json --references          # embeds the cached Figma images
npx groundboard figma entry board.json --frame frame.xml --image frame.png
                                                        # writes the frame's Figma cache entry
npx groundboard validate board.json --check-sources .   # exit 3 on any issue
npx groundboard schema                                  # the board JSON Schema
```

`--check-sources <root>` resolves every cited path under `<root>` (no `..` or symlink escape,
regular files only, at most 2 MB each), checks the line range, and requires each `quote` to
appear in the cited lines, ignoring whitespace. Without it the board says
"Sources NOT checked" in its title.

Exit codes: 0 ok, 1 I/O error, 2 bad arguments, 3 invalid board or failed source check.

## Use it from any MCP client

`groundboard mcp` serves four tools over stdio:

| Tool               | What it does                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| `get_board_schema` | Returns the JSON Schema and the [IR guide](plugins/groundboard/skills/board/references/ir-guide.md). |
| `validate_board`   | Validates a board; with `checkSourcesRoot`, checks its quotes against the files.                     |
| `render_board`     | Renders a board; with `outputPath`, writes the scene under `.groundboard/`.                          |
| `check_atlas`      | Checks every board of an atlas directory and reports refs, stale boards and grounding; takes `require` and `baseline` like `atlas check`. |

For example, in a client's MCP configuration:

```json
{
  "mcpServers": {
    "groundboard": {
      "command": "npx",
      "args": ["-y", "groundboard", "mcp"],
      "env": { "GROUNDBOARD_ROOT": "/path/to/your/project" }
    }
  }
}
```

File access is confined to `GROUNDBOARD_ROOT` (or the working directory): `checkSourcesRoot`
must be that directory or one inside it, and `outputPath` must be a `.excalidraw` file inside
its `.groundboard/` directory. An existing file is replaced only when groundboard wrote it.
If that directory is a filesystem root or your home directory, the server starts without file
access and says so on stderr.

## Web viewer and HTTP server

```sh
npx groundboard serve            # http://127.0.0.1:8787
```

The viewer takes board IRs and `.excalidraw` files (pick several, drop or paste), shows them
in the Excalidraw editor, lists the selected element's citations, and exports `.excalidraw`,
PNG and SVG. Without `--atlas` it looks like the atlas: the boards you opened are listed in the
sidebar by kind, with the home page, Ctrl K search and the links between their refs, and the
list is kept in the browser (IndexedDB), so it is still there after a reload. A board opened
again under the same file name replaces its copy; the sidebar's × removes one and the home page
clears the list. Until you open one, a small sample atlas is shown. Boards are validated, laid
out and rendered in the browser itself, in a Web Worker, and nothing is uploaded; there is no
repository to compare quotes with, so each board says "Not checked against code" (run
`groundboard atlas check` for that). The font picker above the canvas shows the board's text in a plain sans (Nunito) by
default, or in the font it was drawn with, the hand-drawn font, the system sans or a monospace
font; the choice is remembered in the browser, and an export carries the font on screen. The
settings button in the header (in the sidebar's foot when an atlas is open) picks the
interface language, English, Japanese or Vietnamese (the browser's language until one is
picked; board text and the server's messages stay as written), follows the system's light or
dark setting, or fixes either one, and picks the viewer's style: Classic
(slate and indigo), Precision (neutral zinc and cobalt), Blueprint (drafting paper and navy
ink), Editorial (warm stone and teal) or Signal (charcoal and lime). A style changes the
chrome around the board, not the board's own colours; every choice is remembered in the
browser, and exports stay light. Fonts are served locally; the page makes no third-party
request, and its Content-Security-Policy would block one (`connect-src`, `font-src`,
`img-src` and `script-src` allow only the page's own origin; `form-action 'none'`). Excalidraw's
links off the machine are left out of the canvas: its library panel, its social links and the
help dialog's links. A board's own `https` links still open in a new tab when clicked, without
a referrer. Excalidraw's Open, Save to and Reset the canvas are turned off as well: the
sidebar's Open file and the Export menu do the first two, and the last would only clear the
board being read. `pnpm test:browser` checks all of this in Chromium.

**Editing.** "Edit" above an atlas board (or a board of the list kept in the browser) opens a
side panel: change the label, detail, action or unresolved text of the selected node or the
label of an arrow, remove it (with everything that depends on it: a screen's elements and
states, the arrows that touch them and the sources nothing else cites), connect two selected
nodes, or add a node of any kind. A double click on a box opens its label in the panel; text is
never typed on the canvas. Every change is checked as it is made, and one that would make the
board invalid is refused. What you add or reword is marked `"manual": true`: it counts as
unresolved, is drawn dotted with a "manual" tag, `atlas check` lists it and `--require code`
fails on it; a reworded claim's sources move to `priorSourceIds`, shown as "To check again", so
an older groundboard that ignores `manual` refuses the board instead of passing it for checked.
Ctrl Z and Ctrl Shift Z undo and redo content edits and moved boxes in one history (Excalidraw's
own undo is off while editing). "Save" writes the board through `PUT /api/atlas/boards/<slug>`
(up to 8 MB, against the ETag it read: a file an agent wrote meanwhile is refused, and the board
can be loaded again) and the layout beside it.

**Layout.** In edit mode you can also drag boxes and draw notes, shapes and arrows on the canvas; elements of a screen,
states and arrows stay put, and dragging a screen with states moves all of its frames. "Save" writes the layout to
`.groundboard/<slug>.overlay.json` beside the board, never into the board itself:
each box is kept as an offset from where the layout puts it, so it keeps its nudge when an
agent writes the board again and the layout shifts, and a note drawn over a box follows that
box. Notes keep only shape, colour, stroke and text (never a link, an image or an embed).
`groundboard render`, `render_board` with an `outputPath`, `serve --atlas` and `export` all
apply the overlay; `render --no-overlay` leaves it out, and `atlas check` warns about an
overlay entry that matches nothing, an overlay that fails its schema and one with no board.
Saving writes files only under `serve --atlas` on 127.0.0.1 (`PUT
/api/atlas/boards/<slug>/overlay` with the ETag it read, so a save over a file changed since is
refused). Elsewhere (an exported page, a server on another machine) a save is kept as a draft
in this browser's IndexedDB (`groundboard-drafts`, kept apart per atlas) and goes into "Download
zip" ("Edited boards only" packs just those); a board with a draft is rendered in the browser
and marked "Draft", and if its file changed since, the viewer asks whether to keep the draft.
The list kept in the browser stores edits with its board. Without IndexedDB the viewer says
that drafts last until the page is closed.

**Zips.** The Export menu's "Download zip" saves every board of the atlas (or of the list
kept in the browser) in one zip: `.groundboard/<slug>.board.json` and its
`.groundboard/<slug>.overlay.json` as written (drafts in their place), and, when you
pick "With rendered scenes and images", `.groundboard/<slug>.excalidraw` and
`images/<slug>.png` too, drawn in the browser one board at a time (with a progress bar and a
Cancel button). Boards that could not be rendered are named in `errors.txt`. Under
`serve --atlas` the server packs the board files in one request (`GET /api/atlas/export.zip`,
`?include=excalidraw` adds the scenes), and `GET /api/atlas/boards/<slug>/source` returns one
board file as written, with its SHA-256 as the `ETag`. Without an atlas, Open file also takes
a `.zip`: its boards and scenes join the list, after asking before it replaces any already
there. The zip is read in a Web Worker and checked before it is unpacked: at most 200 boards,
8 MB per file, 64 MB in all, no file claiming more than 100 times its packed size, and no
entry name that is absolute or holds `..`, `\` or NUL; any of these refuses the whole zip.
Each board is validated on its own, so one bad board is listed as rejected and the others
load; a scene beside a board of its name is skipped (the board is kept), and scenes lose their
images and embedded pages. Only unpack a zip you made yourself into your repository: unpack it
into a temporary folder, look at the diff, then copy the files into `.groundboard/`.

The same server answers `POST /api/render`, `POST /api/validate`, `GET /healthz` and the MCP
endpoint `/mcp` (Streamable HTTP, stateless). Over HTTP the tools have no file access, so
boards rendered there always say "Sources NOT checked". The server stores nothing, binds to
`127.0.0.1` unless `--host` is given, limits bodies to 1 MB and each client (an IPv6 client
by its /64) to 60 requests a minute and one layout at a time, and lays boards out in worker threads with a 5 s limit.

| Setting                     | Effect                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `--host`, `--port`          | Bind address and port (default `127.0.0.1:8787`).                                            |
| `--trust-proxy <cidr>`      | Use `X-Forwarded-For` from this proxy range for rate limiting; repeatable.                   |
| `GROUNDBOARD_ALLOWED_HOSTS` | Comma-separated hostnames accepted in `Host` and browser `Origin` headers.                   |
| `GROUNDBOARD_TOKEN`         | Require `Authorization: Bearer <token>` on `/api/*` and `/mcp`; the viewer asks for it once. |

## Share the atlas

People who do not read code can read the atlas without cloning the repository or running
Node. `export` writes it as a static site: the viewer, the atlas index and every board
rendered as `serve --atlas` renders them.

```sh
npx groundboard export --out site                 # the atlas in .groundboard/
npx groundboard export --out site --root ../app --skip-cjk-fonts --no-references
python3 -m http.server -d site 8000               # or any static host: GitHub Pages, a zip
```

| Option              | Effect                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `--out <dir>`       | Required. Must be empty or not exist, and neither inside the atlas directory nor around it.        |
| `--root`, `--atlas-dir` | As for `atlas check` and `serve --atlas`.                                                      |
| `--no-references`   | Leave the cached Figma images out of the boards (they are in by default, as with `serve`).         |
| `--skip-cjk-fonts`  | Leave out the Chinese, Japanese and Korean handwriting font, about half the files.                 |

The pages are a snapshot: the atlas home and every board say when the sources were checked,
at which commit, and whether the working tree had uncommitted changes. Stale and invalid
boards are exported as they are and shown as such; the command warns about them and still
exits 0. A board larger than 15 MB with its Figma images is exported without them. Each
board's JSON also carries its board file and layout overlay as written (`source`, `overlay`), so
a reader can download the
boards as a zip from the exported page; the number of files does not change. Opening a local
board file needs the server, so the exported viewer has no "Open file" button.

From Claude Code, `/groundboard:publish` runs the export and posts it as a private
[Claude Artifact](https://claude.ai), after asking whether quoted code and, separately, the
Figma images may leave the machine. It keeps the Artifact's URL in `.groundboard/publish.json`;
commit that file so the next publish, by anyone, updates the same link. Others see the page
once you share it from the Artifact's Share menu, and a link ending in `#<board-name>` opens
that board. An Artifact holds at most 511 files and 256 MB, and takes at most 255 files per
publish, so the skill posts larger exports in several calls; `export` says when an export
needs that, or does not fit at all.

## Docker

```sh
docker run -p 8787:8787 -e GROUNDBOARD_ALLOWED_HOSTS=localhost ghcr.io/lamngockhuong/groundboard
```

The image runs the server as a non-root user on distroless Node 26 and has a health check on
`/healthz`. [`docker/compose.yaml`](docker/compose.yaml) shows a deployment with allowed hosts,
an optional token read from an uncommitted env file, a proxy setting, and a debug variant
with a shell.

## The board format

A board is JSON with `schemaVersion: 1`, a `title`, the `question`, and lists of `groups`,
`nodes`, `edges` and `sources`. Node kinds are `step`, `state`, `decision`, `cause`,
`rejected`, `fact`, `question` and `note`; every kind except `question` and `note` must cite
a source, and a code source it cites needs a `quote`. Sources are code (the default), or the
specification: `doc`, `figma`, `mockup` and `link`. See the [IR guide](plugins/groundboard/skills/board/references/ir-guide.md),
the [JSON Schema](packages/schema/board.schema.json) and the [examples](examples/).

## Run from source

Every section above uses the published package through `npx`. To run groundboard from a
clone instead (before a release, or to try a change), build it once:

```sh
git clone https://github.com/lamngockhuong/groundboard.git
cd groundboard
corepack enable          # pnpm at the pinned version; on Node 25+ without corepack:
                         # npm install -g pnpm@12.21.0
pnpm install
pnpm -r build            # builds the packages and the viewer into packages/groundboard/dist
```

The built command is `packages/groundboard/dist/cli.mjs`. Every `npx groundboard <args>` in
this README becomes `node packages/groundboard/dist/cli.mjs <args>`; an alias saves typing:

```sh
alias groundboard="node $PWD/packages/groundboard/dist/cli.mjs"
```

Run `pnpm -r build` again after changing the source; nothing rebuilds on its own, except the
viewer under `pnpm dev` (see [CONTRIBUTING.md](CONTRIBUTING.md#development-loop)).

### CLI

```sh
groundboard render examples/checkout-flow.board.json --check-sources .
groundboard validate examples/order-state-machine.board.json --check-sources .
```

### Web viewer and HTTP server

```sh
groundboard serve                # http://127.0.0.1:8787
groundboard serve --port 8790    # if 8787 is taken
```

Open the address in a browser: a sample atlas is shown until you open board IRs (for example
`examples/checkout-flow.board.json`) or `.excalidraw` files, which the browser then keeps in
its list. Stop the server with Ctrl+C.
The viewer is served from the build, so rebuild before reloading the page after a change.

### MCP server in Claude Code

Register the local build for one project, from the project you want boards for:

```sh
GROUNDBOARD=/path/to/groundboard       # your clone
cd /path/to/your/project
claude mcp add groundboard --env GROUNDBOARD_ROOT="$PWD" \
  -- node "$GROUNDBOARD/packages/groundboard/dist/cli.mjs" mcp
```

Other MCP clients take the same command in their configuration: `node` with the arguments
`<clone>/packages/groundboard/dist/cli.mjs mcp`, and `GROUNDBOARD_ROOT` set to the project.

### Claude Code plugin

The plugin in `plugins/groundboard` starts its MCP server with
`npx groundboard@<pinned version>`, which needs the published package. To use the skill from
a clone (for example to try `/groundboard:atlas`, `/groundboard:screen` and `check_atlas`
before they are published), copy the plugin and point its MCP server at the local build:

```sh
GROUNDBOARD="$PWD"                     # run from the clone
PLUGIN="$HOME/.cache/groundboard-plugin"
rm -rf "$PLUGIN" && cp -r plugins/groundboard "$PLUGIN"
cat > "$PLUGIN/.mcp.json" <<EOF
{
  "mcpServers": {
    "groundboard": {
      "command": "node",
      "args": ["$GROUNDBOARD/packages/groundboard/dist/cli.mjs", "mcp"],
      "env": { "GROUNDBOARD_ROOT": "\${CLAUDE_PROJECT_DIR}" }
    }
  }
}
EOF
```

Then start Claude Code in the project you want boards for, with the plugin loaded for that
session, and ask a question:

```sh
cd /path/to/your/project
claude --plugin-dir "$HOME/.cache/groundboard-plugin"
```

```text
/groundboard:board how does a request reach the database?
```

Copy the plugin again after changing `plugins/groundboard`; the copy does not follow the clone.

### Docker image

```sh
docker build -f docker/Dockerfile -t groundboard:local .
docker run --rm -p 8787:8787 groundboard:local
```

## Development

Requirements: Node 24 or later, pnpm through corepack (`corepack enable`). Setting up, the
development loop, the checks and the commit conventions are in
[CONTRIBUTING.md](CONTRIBUTING.md).

```sh
pnpm install
pnpm dev                        # needs the build: the viewer from source, with hot reload, on :5173
pnpm lint
pnpm -r typecheck
pnpm -r build
pnpm test                       # needs the build: end-to-end tests spawn the built CLI
pnpm -C packages/groundboard exec playwright install --only-shell chromium   # once
pnpm test:browser               # needs the build: the served viewer reaches nothing off the machine
node scripts/check-pack.mjs     # pack, inspect and smoke-test the npm tarball
```

| Path                         | Contents                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `packages/schema`            | Board IR (Zod), validation, JSON Schema                                      |
| `packages/layout`            | Text measurement, elkjs layout, worker-thread runner                         |
| `packages/render-excalidraw` | `LaidOutBoard` to `.excalidraw` scene                                        |
| `packages/groundboard`       | The published package: pipeline, source check, CLI, MCP, HTTP server         |
| `apps/web`                   | The viewer (Vite, React, `@excalidraw/excalidraw`), bundled into the package |
| `plugins/groundboard`        | The Claude Code plugin; the repository is its own marketplace                |

Only `groundboard` is published; the other packages are private and bundled into it.

TypeScript is pinned to 7.0.2. A tsdown build emits declarations with it; tsdown prints a
deprecation notice for the 7.0 generator and asks for 7.1 once that ships.

### Client-content guard

Enable the pre-push hook once per clone:

```sh
git config core.hooksPath .githooks
```

The hook reads an untracked denylist at `.git/info/denylist` (one term per line) and blocks
a push whose commit messages or added lines contain any term. Without that file the hook
passes silently.

## Releases

Releases are cut by [release-please](https://github.com/googleapis/release-please) from
conventional commits. When a release pull request is merged, the release workflow:

1. publishes `groundboard` to npm with provenance through trusted publishing (no stored token);
   pre-release versions go to the `next` dist-tag;
2. builds and pushes `ghcr.io/lamngockhuong/groundboard:<version>` (and `latest` for stable versions);
3. only after the npm publish succeeded, opens a pull request that moves the plugin's pinned
   version and every skill's metadata version (`scripts/bump-plugin-version.mjs`), so the
   plugin never points at a version npm does not have; `scripts/check-plugin-version.mjs` fails
   when a skill's version differs from the plugin's.

A skill that needs a newer MCP server (`/groundboard:api` needs one that knows `endpoint`) is
merged only after the version that has it is published and pinned. Each such skill also asks
the server for its schema first and stops, saying so, when the server is older.

Versions are pre-releases (`0.1.0-rc.N`) until the first stable release; to cut it, set
`"versioning": "default"` and remove `"prerelease"` in `release-please-config.json`.

### Maintainers: before making the repository public

- Run the denylist over the whole history: `node scripts/check-denylist.mjs --all`.
- Run a secrets scan over the whole history (for example `gitleaks detect`).
- Run `node scripts/check-pack.mjs` and read the file list it prints.
- Confirm npm trusted publishing is configured for the `groundboard` package and this repository.

## License

MIT. Third-party notices for everything the package depends on or ships in its viewer,
including the OFL-1.1 fonts, are generated into the package as `THIRD_PARTY_NOTICES.md`.
