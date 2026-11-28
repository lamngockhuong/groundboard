---
name: groundboard
description: Diagrams grounded in the code they describe
colors:
  accent: "#4f46e5"
  accent-hover: "#4338ca"
  accent-soft: "#eef2ff"
  logo-end: "#7c3aed"
  ink: "#0f172a"
  ink-soft: "#334155"
  muted: "#64748b"
  line: "#e2e8f0"
  line-strong: "#cbd5e1"
  surface: "#f8fafc"
  surface-2: "#f1f5f9"
  panel: "#ffffff"
  on-accent: "#ffffff"
  ok: "#067647"
  ok-soft: "#ecfdf3"
  warn: "#b54708"
  warn-soft: "#fffaeb"
  danger: "#b42318"
  danger-soft: "#fef3f2"
  spec: "#1d4ed8"
  accent-dark: "#818cf8"
  ink-dark: "#e2e8f0"
  muted-dark: "#94a3b8"
  surface-dark: "#0b1120"
  panel-dark: "#111827"
  line-dark: "#1e293b"
  backdrop: "rgb(15 23 42 / 0.4)"
  backdrop-dark: "rgb(2 6 23 / 0.65)"
typography:
  headline:
    fontFamily: "Inter, Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.6rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "Inter, Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.06em"
  mono:
    fontFamily: "ui-monospace, Cascadia Code, JetBrains Mono, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.85em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  pill: "999px"
spacing:
  xs: "0.35rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.25rem"
  xxl: "2rem"
  sidebar: "16.5rem"
  rail: "56px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.sm}"
    padding: "0.4rem 0.9rem"
    height: "2.25rem"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.sm}"
    padding: "0.4rem 0.9rem"
    height: "2.25rem"
  button-secondary-hover:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
  button-ghost:
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.sm}"
  button-ghost-hover:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.75rem"
    height: "2.5rem"
  card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.xl}"
    padding: "1rem 1.25rem"
  nav-item-current:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.md}"
  status-ok:
    backgroundColor: "{colors.ok-soft}"
    textColor: "{colors.ok}"
    rounded: "{rounded.pill}"
  status-stale:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn}"
    rounded: "{rounded.pill}"
  status-invalid:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.pill}"
---

# Design System: groundboard

## Overview

**Creative North Star: "The Annotated Blueprint"**

The viewer is the paper a blueprint is printed on: cool, neutral, and quiet, so the board and
its annotations carry the page. The chrome around the canvas (header, toolbar, source panel)
stays thin and slate-grey; colour is spent on meaning, never on decoration. Every place a claim
is shown, its grounding is shown with it: backed by code, spec only, or unresolved, and whether
the code has changed since.

Density is that of a working tool, not a marketing page: 15px body text, compact 36px
controls, hairline borders. Light and dark themes are both first-class, switched by
`data-theme` on `<html>` with a system-following default.

The indigo accent and the indigo-to-violet logo gradient are provisional. A rebrand is
planned; until then they stay as they are, but nothing new should be built on them as identity.

**Key Characteristics:**
- Cool slate neutrals with one accent hue.
- Semantic colour reserved for status and grounding.
- Near-flat surfaces; depth appears on interaction.
- Monospace for anything that is a path, id, ref or quote from code.
- Every token defined once on `:root` and redefined under `[data-theme="dark"]`.
- Five styles of the chrome (see Styles), picked beside light and dark; the tokens below are
  the Classic style.

## Styles

The settings menu (the header button, or the sidebar's foot with an atlas) picks the interface
language (English, 日本語, Tiếng Việt, each named in itself; `groundboard.locale`, set as `lang`
on `<html>`), light, dark or the system's choice, and one style, set as `data-style` on `<html>` and remembered in
`localStorage` (`groundboard.style`). A style redefines tokens only: colours, `--font`,
`--mono`, radii, the group-heading tokens (`--label-font`, `--label-case`, `--label-track`) and
the button response tokens (`--hover-transform`, `--hover-shadow`, `--hover-shadow-2`,
`--press-transform`). The board keeps the colours the renderer drew.

| Style | Colour | Type | Hover and press |
| --- | --- | --- | --- |
| Classic | slate, indigo `#4f46e5` | Inter (system fallback) | tinted glow; press scales to 0.97 |
| Precision | zinc, cobalt `#2563eb` | Geist, Geist Mono | crisp 1px edge, no movement |
| Blueprint | drafting paper, navy ink, vermilion `#c2410c` | IBM Plex Sans, IBM Plex Mono; mono uppercase headings | rises off a hard 2px offset shadow, sinks back on press |
| Editorial | warm stone, teal `#0f766e` | Figtree, JetBrains Mono; sentence-case headings | soft 1px rise with a tinted, diffuse shadow |
| Signal | charcoal, lime `#a3e635` (dark) / `#3f6212` (light) | Inter, JetBrains Mono; mono uppercase headings | glow ring, no movement |

**The Full Pair Rule.** A style's rule under `:root[data-style="…"]` and its dark rule under
`:root[data-style="…"][data-theme="dark"]` set the same colour tokens, so the light values
never leak into dark. Every pair is checked against 4.5:1 (3:1 for field borders).

**The Quiet Row Rule.** Only primary and secondary buttons rise or glow on hover. Ghost
buttons, menu rows, chips and segmented options only tint, so lists never jitter. Every
button answers a press; `prefers-reduced-motion` keeps the colour change and drops the
movement.

## Colors

A cool slate neutral ramp with a single indigo accent and a small, fixed set of semantic
colours for status and grounding.

### Primary
- **Blueprint Indigo** (`accent`): primary buttons, links, focus outline, hover border on
  cards and drop zone. Lightened to `accent-dark` in dark mode. *Provisional until the rebrand.*
- **Indigo Wash** (`accent-soft`): hover fill of secondary buttons, icon tiles, the token form
  background, the active drop zone.

### Neutral
- **Drafting Ink** (`ink`): body text and headings.
- **Graphite** (`ink-soft`): secondary text, labels, ghost button text.
- **Pencil Grey** (`muted`): hints and meta text. Use only on `surface` or `panel`; on
  `surface-2` it falls below 4.5:1.
- **Paper** (`surface`) and **Sheet** (`panel`): page background and raised panels.
- **Tracing Grey** (`surface-2`): chips, counts, empty icon tiles, ghost hover.
- **Hairline** (`line`) and **Rule** (`line-strong`): dividers and control borders.

### Semantic
- **Verified Green** (`ok`/`ok-soft`): up to date; claims backed by code.
- **Amber Caution** (`warn`/`warn-soft`): stale boards, unresolved claims, warnings.
- **Signal Red** (`danger`/`danger-soft`): invalid boards, errors, validation issues.
- **Spec Blue** (`spec`): claims backed by a specification only.

### Named Rules
**The Meaning-Only Colour Rule.** Green, amber, red and spec blue mean grounding or status and
nothing else. Never use them for decoration, and never show a status by colour alone: a text
label always goes with it.

**The Paired Token Rule.** Every colour token used in CSS exists in both themes. A literal
colour in a rule is a bug.

## Typography

**Body Font:** `--font`. Classic uses Inter, falling back to the platform UI sans (Segoe UI
Variable, system-ui); Inter is not bundled, so most users see the system font. The other
styles bundle their fonts from `@fontsource` packages (OFL-1.1, listed in the generated
third-party notices); the viewer may not load web fonts from a third party.
**Mono Font:** `--mono`. Classic uses the ui-monospace stack (Cascadia Code, JetBrains Mono,
Menlo, Consolas).

**Character:** neutral UI sans for reading, monospace as a signal that a string comes from
the code.

### Hierarchy
- **Headline** (700, 1.6rem, 1.25): page titles such as "Screen atlas" and "Open a board".
- **Title** (600–700, 0.95–1.05rem): app name, board title in the toolbar, panel headings.
- **Body** (400, 15px, 1.5): descriptions; long text capped near 40rem.
- **Label** (600, 0.75–0.8rem, `--label-track`, `--label-case`, `--label-font`): group
  headings only; Classic draws them at 0.06em in uppercase. Status and
  badge text is 0.75rem, weight 500, sentence case.
- **Mono** (0.85em): paths, node ids, refs, quoted source lines.

## Layout

**With an atlas** (`serve --atlas`), the app is two columns: a sidebar of `--sidebar-w`
(16.5rem) on the left and the main column on the right. The main column holds the notice rows
(warning, error, token form), then either the atlas home or the workspace.

- **Sidebar:** brand and collapse button, board filter (`/` focuses it), "Search everything"
  (opens the command palette), "Atlas home", then the boards grouped as Overviews, Screens and
  Flows with counts. The open board has `aria-current="page"`. "Open file" and the settings menu
  sit at the bottom; the menu opens upward. The list scrolls; the top and bottom stay put.
- **Collapsed:** a rail of `--rail-w` (56px) with icon buttons only: expand, atlas home, search,
  open file, settings. The choice is kept in `localStorage`.
- **Atlas home:** a centred column at `min(64rem, 100%)`: stat cards in
  `repeat(auto-fit, minmax(10rem, 1fr))`, the grounding card, the "Needs attention" card.
- **Workspace:** the editor fills the remaining space; the source panel is a 22rem column on
  the right with a sticky header. The panel toggle in the toolbar hides it and widens the
  canvas; each tab keeps its own choice (see Tabs below).
- **Split view:** two panes side by side in the workspace, the left one `--split` wide (25% to
  75%, half and half until dragged), each with its own tab bar over its own board, and one
  source panel to the right of both that shows the focused pane's selection. The panel's
  toggle in either pane's toolbar opens or closes it for both panes, so moving the focus never
  makes it come or go. The status and warning lines sit above both panes, under none. Between the panes a
  hairline handle (a `separator` with an 8px grip) turns indigo on hover, focus and drag; it
  takes ← and → (Shift for 10%), Home and End, and a double click goes back to half and half.
  The ratio is kept in `localStorage`. The focused pane carries a 2px indigo line along the top
  of its tab bar and is named "active pane" to screen readers; the other pane's tab on screen
  keeps a neutral line under it.
- **Board toolbar:** the actions sit in three groups parted by a hairline: what the board is
  doing (design, edit, present), how it reads (layers, font), and what leaves it (export,
  source panel). All are ghost controls. When the board column is narrower than 80rem the
  grouped buttons keep only their icons, so the title and the actions share one row; the
  edit-mode Save and Done keep their labels.
- **Open file:** a modal dialog holding the load panel.
- **Breakpoint at 1024px:** narrower than this, the two panes fold into one tab bar holding
  every tab (the left pane's first) and one board, the focused pane's; there is no handle and
  nothing opens beside. The other pane's board is hidden, not closed: nothing asks, nothing on
  it is lost, and widening again brings both panes back exactly as they were.
- **Breakpoint at 760px:** the sidebar becomes a drawer, opened from a menu button in a slim
  header and closed by Esc, the backdrop, or following a board link; focus stays inside while
  it is open. The source panel moves below the canvas (max 40% height); the toolbar title is
  cut short rather than wrapped.

**Without an atlas** (plain `serve`, or the viewer on a static host), the same layout lists the
boards opened in this browser: sidebar, home, palette and ref links all work on that list. The
home is titled "Opened boards" (or "Sample boards" while the sample atlas stands in) with an
"Open files" primary button and a secondary "Clear the list". Each sidebar row of the list has
a × that shows on hover or focus (always on touch screens). The toolbar's status chip is a
neutral "Not checked against code". The single-column page (header, notice rows, start page)
remains only for an exported page whose data cannot be read.

- **Rhythm:** spacing steps from 0.35rem to 2rem; section gaps 1.25–1.5rem.

## Elevation & Depth

Near-flat by default. Panels and cards sit on the page with a hairline border and an almost
invisible `shadow-sm`; depth grows only in response to interaction.

### Shadow Vocabulary
- **Resting** (`shadow-sm`): the load panel, secondary buttons.
- **Lifted** (`shadow-md`): an open menu, dialog, drawer or command palette.

### Named Rules
**The Earned Lift Rule.** A surface gets `shadow-md` only while it is open or otherwise
interacted with. Nothing is lifted at rest. Modal surfaces sit over the `backdrop` token.

## Shapes

Gently rounded rectangles: 6px on controls, 8px on icon tiles and sidebar items, 10px on
menus and the load panel, 12px on the atlas home cards, dialogs and the command palette. Pills (999px) for status, badges and counts. Circles for the drop and empty-state
icon tiles. Dashed borders mean "a place to put something" (drop zone, empty states); a
dotted border means "spec only" grounding.

## Components

### Buttons
- **Shape:** gently rounded (6px), at least 36px tall; icon buttons are 36px square.
- **Primary:** indigo fill, white text, weight 500, 0.875rem.
- **Secondary:** sheet fill, rule border, graphite text, resting shadow; on hover the border,
  text and wash turn indigo.
- **Ghost:** transparent, graphite text; tracing-grey fill on hover. Used in the header and
  the export group.
- **Link:** underlined indigo text for in-panel navigation.
- **Hover and press:** primary and secondary buttons take the style's `--hover-shadow` /
  `--hover-shadow-2` and `--hover-transform`; every button but links and menu rows takes
  `--press-transform` and drops its shadow while pressed. Menus open with a 140ms rise.
- **Disabled:** 50% opacity, not-allowed cursor.
- **Focus:** 2px accent outline with 2px offset.

### Inputs / Fields
- **Style:** sheet fill, 1px rule border, 6px radius, inherited font.
- **Focus:** border turns indigo with a 3px soft indigo ring (`--focus-ring`).
- **Textarea:** monospace 0.8rem on paper, vertical resize only.

### Status chips and badges
- **Status:** pill with a 0.4rem dot in `currentColor`, soft semantic fill, label text
  ("Up to date", "Stale", "Invalid").
- **Badge:** pill with hairline border and muted text, for the board's layout origin.
- **Grounding tag:** pill with a `currentColor` border; dotted for spec only.

### Sidebar (signature)
Sheet column with a hairline right border. Items are 36px tall rows: a 0.5rem status dot,
the board title cut short with an ellipsis, and for a board that is not up to date the word
"Stale" or "Invalid" in its semantic colour. Hover is a tracing-grey fill; the current board
is an indigo wash with indigo semibold text. Group headings use the Label style with a count
pill. Where tabs show, each row carries an "Open in a new tab" icon button over its end, shown
on hover or focus (always on touch screens) like the remove button of the browser's list;
Alt and a click on the row does the same, while Ctrl or Cmd and a click and the middle button
stay the browser's own new tab.

### Tab bar
One row above the board toolbar, on the surface colour with a hairline bottom border: Back and
Forward first, apart from the tabs by a hairline, then the tabs. Tabs shrink like a browser's
down to 7.5rem; past that the row scrolls sideways with no scrollbar (a vertical wheel scrolls
it too) and a fade on either edge marks tabs hidden there; hidden when the source has a single board. Each tab is
the board title cut short with an ellipsis, 7.5rem to 14rem wide, and a close button that shows on
the tab on screen, on hover and on focus. The tab on screen is panel-white, semibold, with a
2px indigo line along its bottom. The preview tab, the one an ordinary click replaces, sets
its title in italics and is named "preview" to screen readers too. A tab whose board cannot
be shown (missing or invalid) carries the warning icon and the words, never the colour alone.
It is a WAI-ARIA tablist: arrows, Home and End move the focus, Enter or Space shows the
focused tab, Delete closes it; a double click pins it. Where two panes fit, the bar ends with
an "Open beside" icon button. A right click on a tab, or the ContextMenu key or Shift F10 on
it, opens its menu at the pointer (under the tab from the keyboard): Open beside, Move to the
other pane (with two panes), Pin tab (a preview tab), Close tab. It follows the export menu's
pattern; Esc gives the focus back to the tab. The browser's own menu stays closed on tabs
only, never on board links.

### Atlas home cards
Sheet cards, 12px radius, hairline border, no shadow. Stat cards put the label above the
number; the label carries the semantic colour, the number stays ink. The grounding card shows
a 0.6rem bar (green, spec blue, amber) with a legend in words and counts. "Needs attention"
lists invalid then stale boards, each with a status chip, a link, the board kind and the
reason in words; with none, one green line with a check says every board matches the code.

### Board toolbar
Back and Forward (`Alt+←` and `Alt+→`, arrows rather than chevrons, disabled when there is
nowhere to go) lead the tab bar, as in a browser; where there is no tab bar they lead the
toolbar instead. The toolbar starts with the group stepper: one bordered control holding the
group's name, the previous board (`[`), where the board sits in its group ("2/5", read out as
"Board 2 of 5 in Screens") and the next board (`]`); Alt and a click on a step opens the board
in a new tab. The chevrons sit inside the group's control so they read as moving through the
group, never as history. Then the board title, a status chip ("Stale · N sources" or "Up to
date"), the layout-origin badge, then the reading font, the Export menu and the source panel
toggle (pressed while the panel shows). At the start or end of a group the step button is
disabled and its label says why. A pasted board under an atlas shows Back and Forward and the
title; without an atlas, the title only.

### Export menu
A secondary "Export" button with `aria-haspopup="menu"` opens a lifted menu of three items
(`.excalidraw`, PNG, SVG), each with a muted hint. Arrow keys, Home and End move; Esc closes
and returns focus to the button; Tab or a click outside closes it.

### Motion on the canvas
Motion only says which way a flow runs. It is drawn on one SVG layer over the canvas, never
in the scene, so it is not saved, exported or undone. Selecting a node runs dashes in the
accent colour along its arrows, from start to end, and lights the nodes at both ends with an
accent outline; a Settings switch, off by default, runs every arrow in view. Hiding the arrows
layer hides the motion too. "Present" reveals the board one level of its graph at a time: the
camera eases to the step, its arrows draw in 150ms apart, then the nodes appear. A floating
bar at the bottom of the canvas holds back, play or pause, forward, "Step n of N" (read out
through `aria-live`), the seconds per step (1 to 5) and exit; `→`, `←`, Space and Esc do the
same. With `prefers-reduced-motion`, arrows only change colour and each step shows at once.

### Edit mode
"Edit" opens a panel on the right of the canvas. Fields are 2.25rem tall with a hairline field
border and the accent focus ring; a hint in `muted` sits under a field when it needs one. "Add
a node" lists the kinds as radio cards in groups (flows, screens, API, database, jobs), the
group that fits the board first: each card shows a small swatch of the shape the renderer
draws, the kind's name and a one-line description, and the checked card takes an accent
border on an accent wash. A kind that defines a ref (screen, resource, table, job) offers one
made from the label (`db:don-hang` for "Đơn hàng") as the field's placeholder; left empty,
that ref is used.

The boxes a person may not drag (nodes inside a screen, resource or table, and the arrows)
stay locked on the canvas, but a click still selects them for the panel, and Delete removes
the selection through the panel, after asking. While a node or an arrow is selected,
Excalidraw's style panel is hidden: the board never keeps those styles. It stays for notes,
whose style the layout keeps.

On a sequence board nothing is dragged: its order is its layout, edited in the panel. The kind
picker offers participants (with their category) and questions and notes. A selected participant
gets its label, its category, "Move left" and "Move right" (`Alt+←`, `Alt+→`), forms to add a
message from it or a participant after it, and "Remove participant", whose confirmation counts
the messages that go with it. A selected message gets its label, type, sender and receiver,
"Move up" and "Move down" (`Alt+↑`, `Alt+↓`), a muted line that says before it happens when the
next move takes it out of or into a fragment ("Moving it down puts it in alt [authorized]"), a
form to add a message after it, "Wrap in a fragment…", "Split the branch here" and "Remove
message". Several messages picked with Shift can be wrapped together. A selected guard, tag,
frame or divider gets its operand's condition, the fragment's kind, "Start a new branch at" and
"Remove the frame, keep its messages". Each edit is one step of the same undo history; moving a
column changes no claim, so nothing becomes manual, while moving a message, rewording a guard or
wrapping marks what changed as manual. Each button names its key in its tooltip and in
`aria-keyshortcuts`.

Outside edit mode the canvas still takes drags and drawings, which nothing saves. After the
first such change, a note at the bottom of the canvas says so, with "Edit" (moved boxes and
drawn notes carry over) and "Discard changes".

### Sequence boards
A board with participants is drawn as a sequence diagram, not by the graph layout. Participants
stand in a row in the order the board lists them, each a box with its label and, under it in the
small size, its category; a dashed neutral lifeline (`MUTED`) runs down from each, locked and
carrying no data, so a click beside a message never lands on it. The categories are told apart
by shape as well as colour, and the category is written in the box, so a grey print still reads:
a person has no box, only a small figure at its top left; our own system is a solid indigo box
(`#364fc7` on `#edf2ff`); an outside service a dashed violet box (`#862e9c` on `#f8f0fc`); a
database a green box (`#2b8a3e` on `#ebfbee`) with a cylinder's arcs top and bottom; a queue an
orange box (`#c2410c` on `#fff4e6`) with three bars down its right edge. No category is red: red
means something is wrong.

Messages go one per row, numbered in the order the board lists them (`2. authorize(amount)`),
the label above the line on a canvas-coloured backdrop that hides the lifelines behind it. A
call that waits is a solid ink line with a filled head, a reply a dashed line with an open head,
an async message a solid line with an open head and "(async)" after its label, so the kind never
rests on the arrowhead alone. A fragment is a thin `MUTED` frame round the rows of its messages,
its kind in a small tag at the top-left corner (`alt`, `loop`), its first guard beside the tag
in brackets, and a dashed divider above each later operand with that operand's guard under it.
Every header and divider takes a band of its own, so no text overlaps. Text is ink (4.5:1 and
more in both themes), strokes at least 3:1, as the legibility test checks.

The Sources panel names a participant by its category, a message by its number and label with
"From A to B", its type and what it cites, and an operand by its fragment's kind, its condition
and one sentence saying what the kind means ("Only one of these branches happens..."). A
message's panel has "Previous message" and "Next message", the keyboard's way through the
diagram; the command palette lists participants and messages too. A double click on a message
or a participant that carries a ref opens the board that defines it. The sidebar files a
sequence board under Flows with a small two-lifeline icon after its title, named "Sequence
diagram" for screen readers. Presenting shows the participants first, then one message per
step, each fragment with the first message of its operand.

### Command palette
Ctrl K (Cmd K on macOS) opens it from anywhere, the canvas included, where it takes the key
before Excalidraw's "add link". A modal dialog, 40rem wide, 12vh from the top: a borderless
combobox input with an accent underline, then one listbox in groups (Boards, Nodes on this
board, Refs, Commands), at most 8 results each, prefix matches first. Commands come last, so
Enter on an empty query still opens the first board; the one command, "Open the board on
screen beside it", shows where two panes fit and the atlas has more than one board. The active option has an indigo
wash and a 3px indigo bar. A board pasted under an atlas leaves only the nodes group. Enter
opens a board or ref where an ordinary click would; Ctrl Enter (Cmd Enter on macOS) opens it
in a new tab, which a muted footer line says where tabs show.

### Source panel (signature)
Right-hand panel listing what the selected nodes cite. Each node is a section with a mono
id, a kind chip, a grounding tag, and a list of citations on paper tiles. A tile shows the
location on top and the quote below it in a mono block on sheet. A citation the board check
found changed gets an amber border with a 3px amber left edge and the line "This source
changed since the board was made; the quote may no longer match." with a warning icon, never
the colour alone. "Appears in" offers "Open defining board" when another board defines the
ref, then lists the other boards with the same ref as link buttons.

An endpoint whose handler was read adds a "Guards" section: each guard's name in mono with its
citations below it, or the muted line "No guard found in the handler. This does not say the
endpoint is public." for an empty list; never the word "public" alone. Below it, "Tables and
jobs" lists the endpoint's reads, writes and enqueues, one row each: the verb, the target ref in
mono and an "Open" button to the board that defines it, then the query it cites. The canvas
cannot focus a single tag, so this list is the keyboard's way to every tag of the row.

On the canvas, an endpoint's row keeps its route on the first line; under it, the guard line in
the small size (ink, or `muted` text for "no guard found"), then the tags: small rounded boxes
on a white fill whose outline is the edge's colour (`writes` solid, `reads` and `enqueues`
dashed) and whose text is ink, so the verb is read, not only the colour. A tag selects as its
edge and a double click opens its target, as a numbered tag does on a screen.

### Navigation
With an atlas, the sidebar is the navigation: board links, "Atlas home", the filter and the
command palette; the toolbar steps to the previous or next board of the same group. Without
one, a single header bar holds the back button, logo tile, app name and tagline, with the theme
toggle and "New board" on the right. Every board is reached by its hash deep link
(`#/board/<slug>?node=<id>`).

Back and Forward walk the places visited: each board opened and each node followed by a link
is one place, and coming back to it restores the scroll, the zoom and the selection as the
reader left them, so the source panel shows the same citations again. The toolbar buttons and
the browser's own buttons move through the same history. `Alt+←` and `Alt+→` work on the atlas
home too, but only while nothing is selected on the canvas; with a selection the keys are left
to Excalidraw. Leaving a board with unsaved edits asks first, and staying keeps the history as
it was.

Tabs keep several boards open, up to ten. Following a board link the ordinary way (a click in
the sidebar, `[` or `]`, Enter in the palette) shows it in the preview tab, whose history goes
on; opening it in a new tab (Alt and a click, the row's button, Ctrl Enter in the palette, a
double click on a link to another board, "Open defining board" and "Appears in") adds a pinned
tab after the one on screen, or chooses the tab that has that board already. Editing a board
or a double click on its tab pins it. Opening an eleventh tab closes the unpinned tab used
longest ago; with all ten pinned, the board opens in the tab on screen and a status line says
so. `Alt+1` to `Alt+8` choose a tab, `Alt+9` the last, `Alt+W` closes the one on screen. Each
tab has its own Back and Forward, and choosing a tab again restores its view. Choosing or
closing a tab, or replacing the preview tab's board, asks first when the board holds unsaved
edits or changes made on the canvas outside edit mode. "Atlas home" closes no tab. The tabs
are kept for the browser tab, never in the address: a reload brings them back, and a deep link
opens its board in the preview tab beside them. A board pasted or opened from a file opens in
a new tab that is pinned from the start, so an ordinary click never replaces it and nothing
asks before it opens; closing it asks only when it holds unsaved changes, as any tab does. Its
address is the home, and a reload does not bring it back. Only with all ten tabs pinned can a
board take its place, and that asks first, since the pasted board cannot be opened again.

Split view puts two boards side by side: the tabs then sit in two groups, a left and a right
pane, each with its tab on screen. "Open beside" (the tab bar's button, a tab's menu, or the
palette's command) opens a tab's board in the other pane, where the reader is on it, as a
pinned tab, and moves the focus there; the other group's tab of that board is shown instead
when it has one. A click or the keyboard in a pane focuses it: the address, Back and Forward,
`[` and `]`, `Alt+1` to `Alt+9` (within the pane), `Alt+W`, the palette's nodes and the source
panel follow the focused pane. Closing a pane's last tab leaves one pane. One board is edited
at a time and one presents at a time: the other pane's Edit or Present button is off and says
why, and the keys of editing and presenting reach the focused pane's board only. When both
panes show the same board, a save in one loads it again in the other where it stands. "Atlas
home" takes the focused pane only: the home shows there, under that pane's tab bar with no tab
selected, while the other pane keeps its board to compare with; a board chosen from the
sidebar or the home opens in the pane the home was in. The ten
tabs count over both panes, and a reload brings both back.

Each tab keeps its own toolbar choices: whether the design images show, the layers hidden, the
reading font, and whether the source panel is open. Choosing another tab puts its choices back
on the toolbar and the canvas; a reload keeps them with the tabs. A new tab starts with the
choices made last in any tab (kept in `localStorage`); a choice made in one tab leaves the
other open tabs as they were. A tab keeps hidden only the
layers its board has. Without tabs (no atlas, or one board), the choices made last apply.

On a screen board, a click on the numbered tag or the list line of a link to another screen
selects it and shows its sources; a double click opens the board that defines that screen
(the screen's own board first, then an overview, then a flow). Without an atlas, or when no
board defines the screen, a double click does what Excalidraw does.

## Do's and Don'ts

### Do:
- **Do** define every colour as a token on `:root` and again under `[data-theme="dark"]`, and
  in each style's light and dark rule alike.
- **Do** pair every status or grounding colour with a text label.
- **Do** use monospace for paths, ids, refs and quotes, and sentence case elsewhere.
- **Do** keep controls at least 36px tall and keep the 2px accent focus outline visible on
  every focusable element, including visually hidden inputs behind a styled label.
- **Do** keep all fonts and assets local; the page makes no third-party request.
- **Do** keep canvas motion to the direction of a flow, and drop all of it under
  `prefers-reduced-motion`, keeping the colour.

### Don't:
- **Don't** use semantic colours (green, amber, red, spec blue) for decoration.
- **Don't** write literal colours in rules; use the tokens.
- **Don't** lift surfaces at rest; shadows respond to interaction.
- **Don't** extend the indigo accent or the logo gradient into new identity work before the
  rebrand.
- **Don't** put `muted` text on `surface-2`; use `ink-soft` there.
