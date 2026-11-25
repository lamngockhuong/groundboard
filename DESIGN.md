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
  canvas; the choice is kept in `localStorage`.
- **Board toolbar:** the actions sit in three groups parted by a hairline: what the board is
  doing (design, edit, present), how it reads (layers, font), and what leaves it (export,
  source panel). All are ghost controls. When the board column is narrower than 80rem the
  grouped buttons keep only their icons, so the title and the actions share one row; the
  edit-mode Save and Done keep their labels.
- **Open file:** a modal dialog holding the load panel.
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
pill.

### Atlas home cards
Sheet cards, 12px radius, hairline border, no shadow. Stat cards put the label above the
number; the label carries the semantic colour, the number stays ink. The grounding card shows
a 0.6rem bar (green, spec blue, amber) with a legend in words and counts. "Needs attention"
lists invalid then stale boards, each with a status chip, a link, the board kind and the
reason in words; with none, one green line with a check says every board matches the code.

### Board toolbar
Previous and next board buttons (`[` and `]`), a breadcrumb `<Group> › <Title>`, a status chip
("Stale · N sources" or "Up to date"), the layout-origin badge, then the reading font, the
Export menu and the source panel toggle (pressed while the panel shows). At the start or end
of a group the step button is disabled and its label says why. A pasted board shows the
title only.

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

Outside edit mode the canvas still takes drags and drawings, which nothing saves. After the
first such change, a note at the bottom of the canvas says so, with "Edit" (moved boxes and
drawn notes carry over) and "Discard changes".

### Command palette
Ctrl K (Cmd K on macOS) opens it from anywhere, the canvas included, where it takes the key
before Excalidraw's "add link". A modal dialog, 40rem wide, 12vh from the top: a borderless
combobox input with an accent underline, then one listbox in groups (Boards, Nodes on this
board, Refs), at most 8 results each, prefix matches first. The active option has an indigo
wash and a 3px indigo bar. A board pasted under an atlas leaves only the nodes group.

### Source panel (signature)
Right-hand panel listing what the selected nodes cite. Each node is a section with a mono
id, a kind chip, a grounding tag, and a list of citations on paper tiles. A tile shows the
location on top and the quote below it in a mono block on sheet. A citation the board check
found changed gets an amber border with a 3px amber left edge and the line "This source
changed since the board was made; the quote may no longer match." with a warning icon, never
the colour alone. "Appears in" offers "Open defining board" when another board defines the
ref, then lists the other boards with the same ref as link buttons.

### Navigation
With an atlas, the sidebar is the navigation: board links, "Atlas home", the filter and the
command palette; the toolbar steps to the previous or next board of the same group. Without
one, a single header bar holds the back button, logo tile, app name and tagline, with the theme
toggle and "New board" on the right. Every board is reached by its hash deep link
(`#/board/<slug>?node=<id>`).

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
