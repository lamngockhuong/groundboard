---
name: publish
description: Publish the screen atlas of the current repository (.groundboard/*.board.json) as a private Claude Artifact that people who do not read code can open in a browser, by running `groundboard export` and posting the static result; a second run updates the same link. Asks before anything leaves the machine. Use when someone wants to share the atlas with a PM, BA, QA or client, e.g. "publish the atlas", "share the screen atlas as an artifact", "update the published atlas", "/groundboard:publish".
license: MIT
compatibility: Claude Code with the Artifact tool and Node 24 or later (network on first start for npx).
metadata:
  version: 0.1.0-rc.1
  homepage: https://github.com/lamngockhuong/groundboard
argument-hint: "[--no-references]"
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

Check whether any board has Chinese, Japanese or Korean text: Grep
`.groundboard/*.board.json` for `\p{Han}|\p{Hiragana}|\p{Katakana}|\p{Hangul}`. When none does,
add `--skip-cjk-fonts`; it leaves out about half the files.

```sh
npx groundboard export --out <dir> [--skip-cjk-fonts] [--no-references]
```

Add `--root` or `--atlas-dir` only when the atlas is not `.groundboard/` of the current
directory. Exit code 2 is a bad argument (fix it and run again), 1 an I/O error (report it and
stop). Read what the command prints:

- A warning about stale or invalid boards or atlas problems: tell the user before publishing
  and ask whether to go on. The page shows them as well.
- A board exported without its Figma images because it was too large: tell the user.
- A warning that the export does not fit one Artifact (more than 511 files or 256 MB): stop,
  and suggest `--skip-cjk-fonts`, `--no-references`, or another static host for the folder.

### 3. Write the Artifact page

An Artifact wraps its page in `<html>`, `<head>` and `<body>` itself. Read `<dir>/index.html`
and write `<dir>/artifact.html` holding only, in this order:

1. its `<title>` element;
2. `<meta name="groundboard:mode" content="static" />` (the viewer finds it anywhere in the
   page; without it the viewer looks for a server and shows nothing);
3. its `<link>` and `<script>` elements, unchanged, relative paths included;
4. `<div id="root"></div>`.

### 4. Publish

Read `.groundboard/publish.json` if it exists: `{ "url": "...", "publishedAt": "..." }`.

- **First publish** (no file): publish with `file_path` `<dir>/artifact.html`, `root` `<dir>`,
  `icon` `map`, a one-sentence `description` naming the app, and `files` listing every path
  in `<dir>/manifest.txt` (one path per line, relative to `<dir>`) except `index.html`. Read
  the manifest rather than listing the folder: a file search may cut a long list short. The
  manifest has one line fewer than the file count `export` printed (it does not list itself);
  if the numbers do not match, stop and report it.
- **Update** (file present): read the Artifact first (`action: "read"` with its `url`), then
  list its published files (`scope: "files"`). Publish the same way with that `url`, and add
  every published path that is no longer in the export (a board removed since) to `files` as
  `null`, so the old board does not linger.

At most 250 entries go in `files` per publish. When there are more, send the page with the
first 250, then publish the rest to the same `url` in further calls of at most 250 each,
`file_path` again `<dir>/artifact.html` so the page stays the same.

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
- that other people see the page only after the user shares it from the Artifact's Share menu,
  and that a link ending in `#<board-name>` (letters, digits and dashes) opens that board.
