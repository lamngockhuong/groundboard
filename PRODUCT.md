# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Developers new to a project, who read the screen atlas to learn the screens, the flows
  through them and the code behind each control (click "Pay", see its handler).
- Developers and reviewers on the team, who open a board to check a "why" or "how" answer
  against the `file:line` it cites.
- PMs, BAs and QA who do not read code, who use flows and screens to understand behaviour and
  to see which claims are backed by code, by spec only, or still unresolved.
- The project's client, who compares what was asked for with what was built, typically on a
  team-hosted server.

## Product Purpose

groundboard turns a question about a codebase into an editable Excalidraw board whose every
claim cites the file and lines it rests on, with the quoted text checked against the file. The
web viewer is where people read those boards: the screen atlas index, the board canvas, and the
source panel that shows what a selected node or arrow cites. Success is a reader trusting a
board because they can see, per claim, what it rests on and whether that is still true.

## Positioning

Every node carries checked citations. The viewer surfaces grounding (code, spec only, none)
and staleness (the code changed since the board was made) instead of presenting a diagram as
authoritative. groundboard itself never calls an LLM and needs no API key.

## Operating Context

- Run locally with `npx groundboard serve` on `127.0.0.1`, opened in a desktop browser.
- Run on a team server or the Docker image, shared by several people, optionally behind
  `GROUNDBOARD_TOKEN`; the viewer asks for the token once.
- Read as a static export (`groundboard export`): a folder on any static host, or a private
  Claude Artifact posted by `/groundboard:publish`, for people who do not run Node. It is a
  snapshot that says when and at which commit its sources were checked.
- Boards come from the atlas directory (`.groundboard/*.board.json`), a dropped or pasted
  `.board.json`, or an `.excalidraw` scene. Without an atlas, the viewer renders opened boards
  in the browser and keeps the list in the browser's storage. Boards are produced by the Claude Code plugin
  skills (`/groundboard:board`, `/groundboard:atlas`, `/groundboard:screen`) or any MCP client.

## Capabilities and Constraints

- Viewer: a collapsible atlas sidebar grouped by overview, screen, flow, API, database and jobs, with each board's
  status (up to date, stale, invalid), a drawer on narrow screens; an atlas home with board
  counts, grounding across the atlas and the boards that need attention; previous and next
  board in the toolbar; a Ctrl K command palette for boards, nodes of the open board and
  refs; a double click on a link to another screen opens the board that defines it; deep links
  to a board and node; source panel with citations, quotes, a warning on
  each citation whose code changed, where a ref appears across boards and a button to open the
  board that defines it; reading-font switch; export to `.excalidraw`, PNG and SVG from one
  menu; light, dark and system theme.
- Edit mode: change a node's or arrow's text, add and remove nodes and arrows, drag boxes and
  draw notes, with one undo history for all of it. Content goes into the board file, marked
  `manual` (shown as edited by hand, counted as unresolved, its old sources kept to check
  again); layout goes into an overlay file beside it. Files are written only on a local
  `serve --atlas`; elsewhere edits are drafts in the browser, downloaded as a zip. The viewer
  also downloads every board as a zip and opens a zip of boards into its own list.
- Static export: the same viewer with the atlas as JSON files, no server; it hides what needs
  one (opening a local board file, the token prompt), and a `#<board-name>` link opens a board.
- The page makes no third-party request: fonts and assets are served locally, no CDN.
- API: one board per resource, a card of its endpoints, each citing its route; a control on a
  screen links to the endpoint it calls (`calls`), and a double click follows it.
- Database: tables as cards of columns with foreign keys, from migrations and models only;
  endpoints and steps link to the tables they read and write.
- Background jobs: each job with what starts it (cron, queue, event, manual) and its retries;
  what enqueues it and the tables it touches link to it.
- Terminology: board, board IR, node, edge, ref, citation, grounding (code / spec / none),
  stale, screen atlas, overview, screen, flow, API (resource, endpoint, calls), table, column, job, trigger, manual (edited by
  hand), layout overlay, draft.

## Brand Commitments

- Current name is "groundboard". The name, logo and brand colours are provisional; a rebrand
  is planned. Do not invest in logo or brand-colour work until it happens.

## Evidence on Hand

- Example boards: `examples/` and `examples/fixtures/states/.groundboard`.
- No testimonials, customers or usage metrics exist; do not invent any.

## Product Principles

1. Show what each claim rests on; never present an unchecked claim as checked.
2. Surface staleness and gaps (spec only, unresolved) plainly, not hidden in detail.
3. Readable by people who do not read code, without hiding the citations for those who do.
4. Local and private by default: nothing leaves the machine unless the user runs a server or
   chooses to publish the atlas, and publishing asks first.

## Accessibility & Inclusion

WCAG 2.2 AA is the required minimum for the viewer.
