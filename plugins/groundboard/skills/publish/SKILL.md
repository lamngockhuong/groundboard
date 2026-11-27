---
name: publish
description: Publish the screen atlas of the current repository (.groundboard/*.board.json) as a private Claude Artifact that people who do not read code can open in a browser, by running `groundboard export` and posting the static result; a second run updates the same link. Asks before anything leaves the machine. Use when someone wants to share the atlas with a PM, BA, QA or client, e.g. "publish the atlas", "share the screen atlas as an artifact", "update the published atlas", "/groundboard:publish".
license: MIT
compatibility: Claude Code with the Artifact tool and Node 24 or later (network on first start for npx).
metadata:
  version: 0.1.0-rc.1
  homepage: https://github.com/lamngockhuong/groundboard
argument-hint: "[--no-references] [--skip-cjk-fonts]"
allowed-tools: Read Grep Write Bash(npx groundboard export:*) Bash(mkdir -p .groundboard/.cache/publish) Bash(cp * .groundboard/.cache/publish/manifest.txt) Artifact
---

# groundboard publish: the atlas as a Claude Artifact

`groundboard export` writes the atlas as a static site: the viewer, `data/atlas.json` and one
`data/boards/<slug>.json` per board, rendered exactly as `serve --atlas` renders them, with the
time and commit the sources were checked at. You post that folder as one Artifact and keep its
URL in `.groundboard/publish.json`, so the next run updates the same link instead of making a
new one, and keeps what it published in `.groundboard/.cache/publish/`, never committed, so
the next update on this machine knows which files to remove without listing them all.

The page is a snapshot. It shows when it was checked; it does not follow the code.

## Procedure

### 1. Ask before anything leaves the machine

Publishing sends the atlas to claude.ai: every quoted code excerpt, every cited file path, the
board titles, and each board file in full as written (`source`, so readers can download the
boards as a zip), which includes every node's text, and each layout overlay
(`.groundboard/*.overlay.json`) with every note a person drew on a board in the viewer. Say so, and say that the Artifact starts private: nobody else sees it until
the user shares it from its Share menu. Ask the user to confirm. If they decline, stop here:
run nothing and write nothing.

If `.groundboard/.cache/figma/` holds any file, the boards also carry the cached Figma design
images. Ask separately whether to send them. Leave them out (`--no-references`) when the user
says no or passed `--no-references`.

### 2. Export

Pick a new, empty directory in your scratchpad directory (or the system temp directory when
there is none), for example `<scratchpad>/groundboard-export-<YYYYMMDD-HHMMSS>`. Never point
`--out` inside `.groundboard/`.

Name the page after the app, for example `Acme screen atlas`, from the repository's README or
package name: the Artifact gallery shows the page's title, and without `--title` every atlas
is called "groundboard".

```sh
npx groundboard export --out <dir> --title "<App> screen atlas" [--no-references] \
  [--previous .groundboard/.cache/publish/manifest.txt]
```

Add `--previous` when `.groundboard/publish.json` and `.groundboard/.cache/publish/last.json`
both exist and hold the same `url`: that is the record of the last publish from this machine
(step 5). `export` then also writes `<dir>/publish-remove.json`, a `{"<path>": null}` map of
the published paths it no longer has, and prints which order to publish in. Whether the record
is still current is checked in step 4, against the Artifact itself.

Add `--root` or `--atlas-dir` only when the atlas is not `.groundboard/` of the current
directory. A `.groundboard` that is a symlink (a git worktree linked to the main checkout's
atlas) needs neither: `export` reads the atlas where the link points and checks the sources in
the current directory. Exit code 2 is a bad argument (fix it and run again), 1 an I/O error
(report it and stop). Read what the command prints:

- A warning about stale or invalid boards or atlas problems: tell the user before publishing
  and ask whether to go on. The page shows them as well.
- A board exported without its Figma images because it was too large: tell the user.
- With `--previous`, two lines: `previously published: <P> file(s) beside the page; <S> no
  longer exported, listed in publish-remove.json; <K> of publish-batch-1.json not published
  before`, and `publish order: ...`, the files to publish in that order (step 4).
- The `CJK handwriting font` line: `export` writes only the parts of the Chinese, Japanese and
  Korean handwriting font that cover characters in the boards and their overlays, none for an
  atlas without them. A reader's edits and notes on the published page stay in their own
  browser and are never published, so Chinese, Japanese or Korean characters a reader types
  there that no board used may show in a system font.
- A warning that the export does not fit one Artifact (more than 511 files or 256 MB): stop,
  tell the user which limit it passes, and offer what fixes that limit, then export again into
  a new directory:
  - too many files: `--skip-cjk-fonts` leaves out the whole CJK handwriting font (the warning
    says how many files that is). Say what it costs: Chinese, Japanese and Korean text then
    draws in a system font instead of the handwriting one. `--no-references` does not help
    here; the Figma images are inside the board files, not files of their own.
  - too large: `--no-references` leaves the Figma images out and makes the boards smaller.
  - either way, any other static host serves the folder as it is.

### 3. Write the Artifact page

An Artifact wraps its page in `<html>`, `<head>` and `<body>` itself. Read `<dir>/index.html`
and write `<dir>/artifact.html` holding only, in this order:

1. its `<title>` element (it holds the `--title` text);
2. `<meta name="groundboard:mode" content="static" />` (the viewer finds it anywhere in the
   page; without it the viewer looks for a server and shows nothing);
3. its `<link>` and `<script>` elements, unchanged, relative paths included;
4. `<div id="root"></div>`.

### 4. Publish

Read `.groundboard/publish.json` if it exists: `{ "url": "...", "publishedAt": "..." }`.

`export` wrote the files to send as `<dir>/publish-batch-1.json`, `publish-batch-2.json`, and so
on, in the order printed. Each is a list `[{"path": "..."}]` of paths relative to `<dir>`, at
most 250 files and 60 MB, ready to pass unchanged as `files` (the list form publishes each file
at its own path, and is about half the size of a `{path: path}` map; do not convert it). One
publish takes at most 255 files and 64 MB; the batches stay below that so the page fits too.
Together the batches list one path fewer than the "files to publish" count `export` printed
(the page is the other one); if the numbers do not match, stop and report it.

- **First publish** (no file): publish with `file_path` `<dir>/artifact.html`, `root` `<dir>`,
  `icon` `map`, a one-sentence `description` naming the app, and `files` the contents of
  `publish-batch-1.json`. Publish each further batch to the URL the first call returned, with
  `file_path` again `<dir>/artifact.html` so the page stays the same.
- **Update** (file present):
  1. Read the Artifact (`action: "read"` with its `url`). Its header names the live version
     (`version <id>`) and how many files it holds, the page included (`This version has <N>
     published files`).
  2. Find the stale paths, the published ones that are not in `<dir>/manifest.txt` (a board
     removed since, or a viewer asset whose hashed name changed):
     - **From the record**, when all of these hold: `export` ran with `--previous`;
       `.groundboard/.cache/publish/last.json` holds this `url` and the `version` the read
       shows; and the `previously published` count `export` printed is `<N>` − 1. The stale
       paths are then the map in `<dir>/publish-remove.json`, and the `publish order` line is
       the order. Do not list the published files.
     - **From the listing** otherwise: no record, or someone published since (another version,
       or another count). List the published files (`scope: "files"`); the stale paths are the
       listed paths not in `manifest.txt`, never the page. Ignore `publish-remove.json` and the
       `publish order` line.
  3. Publish, every call with that `url`, `file_path` `<dir>/artifact.html` and `root` `<dir>`,
     in this order:
     1. `files` the contents of `publish-batch-1.json`;
     2. the removals, if there are stale paths: `files` a map of each stale path to `null`, for
        example `{"data/boards/old.json": null}` (the contents of `publish-remove.json` as
        they are, from the record); the list form cannot remove a file;
     3. each further batch, in order.

     The new page goes live with batch 1 while the old files are still there, so a reader with
     the page open loses nothing mid-update. One Artifact version holds at most 512 files, the
     page included, counting old and new together while the update is in progress: if
     (`<N>` − 1) + (the paths of batch 1 not already published) > 511, publish the removals
     first, then every batch. From the record, the `publish order` line already says which.

If a publish fails, stop and report what failed; do not retry the same call unchanged, and
skip step 5's record of what was published (the version changed, so the next update lists the
files instead).

### 5. Record the URL

Write `.groundboard/publish.json`:

```json
{
  "url": "<the Artifact URL>",
  "publishedAt": "<now, ISO 8601 UTC>"
}
```

Keep this layout, two-space indent and a final newline, so a formatter run over the repository
leaves the file as it is.

Tell the user to commit it, so that whoever publishes next updates the same link. It is not a
board: `atlas check` and `export` ignore it.

Then record what was published, for the next update from this machine:

1. `mkdir -p .groundboard/.cache/publish`; if `.groundboard/.cache/.gitignore` does not exist,
   write it containing the single line `*`, so nothing under `.cache/` is committed.
2. `cp <dir>/manifest.txt .groundboard/.cache/publish/manifest.txt`.
3. Read the Artifact once more (`action: "read"`) and write
   `.groundboard/.cache/publish/last.json` with its URL and the version its header names:

   ```json
   {
     "url": "<the Artifact URL>",
     "version": "<the version id>"
   }
   ```

A record that is missing or out of date only costs a listing next time: step 4 checks it
against the Artifact before trusting it.

### 6. Report

- the link;
- how many boards, and how many are stale or invalid;
- the time and commit the sources were checked at (the last line `export` printed), and
  whether the working tree had uncommitted changes (changes in the atlas directory itself,
  or a `.groundboard` symlink, do not count);
- whether the Figma images were sent;
- whether the CJK handwriting font was left out (`--skip-cjk-fonts`), and that Chinese,
  Japanese and Korean text then shows in a system font;
- that other people see the page only after the user shares it from the Artifact's Share menu,
  and that a link ending in `#<board-name>` (letters, digits and dashes) opens that board;
- that the gallery card has no thumbnail when the Artifact holds many files, and that they can
  set one from the Artifact's Share menu.
