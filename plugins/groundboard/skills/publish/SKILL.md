---
name: publish
description: Publish the screen atlas of the current repository (.groundboard/*.board.json) as a private Claude Artifact that people who do not read code can open in a browser, by running `groundboard export` and posting the static result; a second run updates the same link. Asks before anything leaves the machine. Use when someone wants to share the atlas with a PM, BA, QA or client, e.g. "publish the atlas", "share the screen atlas as an artifact", "update the published atlas", "/groundboard:publish".
license: MIT
compatibility: Claude Code with the Artifact tool and Node 24 or later (network on first start for npx).
metadata:
  version: 0.1.0-rc.1
  homepage: https://github.com/lamngockhuong/groundboard
argument-hint: "[--no-references] [--skip-cjk-fonts]"
allowed-tools: Read Grep Write Bash(npx groundboard export:*) Artifact
---

# groundboard publish: the atlas as a Claude Artifact

`groundboard export` writes the atlas as a static site: the viewer, `data/atlas.json` and one
`data/boards/<slug>.json` per board, rendered exactly as `serve --atlas` renders them, with the
time and commit the sources were checked at. You post that folder as one Artifact and keep its
URL in `.groundboard/publish.json`, so the next run updates the same link instead of making a
new one.

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
npx groundboard export --out <dir> --title "<App> screen atlas" [--no-references]
```

Add `--root` or `--atlas-dir` only when the atlas is not `.groundboard/` of the current
directory. A `.groundboard` that is a symlink (a git worktree linked to the main checkout's
atlas) needs neither: `export` reads the atlas where the link points and checks the sources in
the current directory. Exit code 2 is a bad argument (fix it and run again), 1 an I/O error
(report it and stop). Read what the command prints:

- A warning about stale or invalid boards or atlas problems: tell the user before publishing
  and ask whether to go on. The page shows them as well.
- A board exported without its Figma images because it was too large: tell the user.
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
- **Update** (file present): read the Artifact first (`action: "read"` with its `url`), then
  list its published files (`scope: "files"`). Publish every batch the same way with that
  `url`. Then, if any published path is not in `<dir>/manifest.txt` (a board removed since),
  publish once more with `file_path` `<dir>/artifact.html` and `files` a map of those paths to
  `null`, for example `{"data/boards/old.json": null}`, so the old board does not linger; the
  list form cannot remove a file.

If a publish fails, stop and report what failed; do not retry the same call unchanged.

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

### 6. Report

- the link;
- how many boards, and how many are stale or invalid;
- the time and commit the sources were checked at (the last line `export` printed), and
  whether the working tree had uncommitted changes;
- whether the Figma images were sent;
- whether the CJK handwriting font was left out (`--skip-cjk-fonts`), and that Chinese,
  Japanese and Korean text then shows in a system font;
- that other people see the page only after the user shares it from the Artifact's Share menu,
  and that a link ending in `#<board-name>` (letters, digits and dashes) opens that board;
- that the gallery card has no thumbnail when the Artifact holds many files, and that they can
  set one from the Artifact's Share menu.
