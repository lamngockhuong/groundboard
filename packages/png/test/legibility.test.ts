// Every colour pair a board can show, checked for contrast in both themes as the PNG draws them.
//
// The dark PNG is the light scene under Excalidraw's theme filter, `invert(93%) hue-rotate(180deg)`
// on the root <svg>, which resvg applies in sRGB like a browser. The pairs are computed from the
// scene's colours through that filter (exact, no anti-aliasing to guess around); the first test
// checks the filter against pixels resvg actually drew, so the computed numbers are the PNG's.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { renderBoard } from "../../groundboard/src/pipeline.ts";
import { decodePng } from "../../groundboard/src/png.ts";
import { shape } from "../../render-excalidraw/src/elements.ts";
import { EDGE_KINDS, ELEMENT_ROLES, NODE_KINDS } from "../../schema/src/board.ts";

type Rgb = readonly [number, number, number];
type Theme = "light" | "dark";
const THEMES: Theme[] = ["light", "dark"];

/** WCAG 2.2: 1.4.3 for text, 1.4.11 for strokes and shapes. */
const MIN_TEXT = 4.5;
const MIN_MARK = 3;

/** Excalidraw 0.18 draws frames itself: `FRAME_STYLE` in @excalidraw/common. */
const FRAME_STROKE = "#bbbbbb";
const FRAME_NAME = { light: "#999999", dark: "#7a7a7a" } as const;

/**
 * Pairs below the threshold, by "theme | subject", with the ratio measured when the entry was
 * written. Empty while every pair passes. The test fails when a listed pair gets worse, when a
 * pair not listed falls short, and when a listed pair starts passing (remove it then).
 */
const KNOWN_SHORTFALLS: Record<string, number> = {};

interface Accepted {
  ratio: number;
  reason: string;
}

/**
 * Lines kept light on purpose: they divide or decorate a shape that is already told apart by its
 * text and its outline, and a darker line would make wireframes and cards read as heavier than
 * the content in them. Guarded like `KNOWN_SHORTFALLS`.
 */
const DECORATIVE: Record<string, Accepted> = {
  "light | element bar: stroke": { ratio: 1.3, reason: "a bar is told apart by its fill" },
  "dark | element bar: stroke": { ratio: 1.33, reason: "a bar is told apart by its fill" },
  "light | table column: stroke": { ratio: 1.49, reason: "row rules inside a framed table" },
  "dark | table column: stroke": { ratio: 1.59, reason: "row rules inside a framed table" },
  "light | job row: stroke": { ratio: 1.49, reason: "row rules inside a framed job card" },
  "dark | job row: stroke": { ratio: 1.59, reason: "row rules inside a framed job card" },
  "light | image placeholder: stroke": {
    ratio: 1.42,
    reason: "the cross inside an image's outlined box only says 'picture here'",
  },
  "dark | image placeholder: stroke": {
    ratio: 1.52,
    reason: "the cross inside an image's outlined box only says 'picture here'",
  },
};

/**
 * Drawn by Excalidraw itself (`FRAME_STYLE`), not by the board palette: the viewer draws frames
 * with the same constants, and the PNG must match the viewer.
 */
const EXCALIDRAW_DRAWN: Record<string, Accepted> = {
  "light | excalidraw frame: name": { ratio: 2.85, reason: "Excalidraw's frame name colour" },
  "light | excalidraw frame: outline": { ratio: 1.92, reason: "Excalidraw's frame border" },
  "dark | excalidraw frame: outline": { ratio: 2.2, reason: "Excalidraw's frame border" },
};

// ---------------------------------------------------------------------------------------------
// Colour

function parse(color: string): Rgb | null {
  if (color === "transparent") return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) throw new Error(`unparsed colour ${color}`);
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255) as unknown as Rgb;
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** CSS `invert(93%) hue-rotate(180deg)`, the matrices of Filter Effects 1, in sRGB. */
function darkFilter([r, g, b]: Rgb): Rgb {
  const inv = (c: number) => 0.93 * (1 - c) + 0.07 * c;
  const [ir, ig, ib] = [inv(r), inv(g), inv(b)];
  // hue-rotate(180deg): cos = -1, sin = 0.
  return [
    clamp(-0.574 * ir + 1.43 * ig + 0.144 * ib),
    clamp(0.426 * ir + 0.43 * ig + 0.144 * ib),
    clamp(0.426 * ir + 1.43 * ig - 0.856 * ib),
  ];
}

const inTheme = (theme: Theme, c: Rgb): Rgb => (theme === "dark" ? darkFilter(c) : c);

function luminance(c: Rgb): number {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `top` at `alpha` (0..1) over `under`. */
const over = (top: Rgb, alpha: number, under: Rgb): Rgb =>
  top.map((v, i) => v * alpha + (under[i] as number) * (1 - alpha)) as unknown as Rgb;

const toHex = (c: Rgb) =>
  `#${c
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

// ---------------------------------------------------------------------------------------------
// What each element of a scene sits on, and what to call it

interface El {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  backgroundColor: string;
  opacity: number;
  groupIds: string[];
  containerId?: string | null;
  isDeleted?: boolean;
  name?: string | null;
  customData?: { groundboard?: Record<string, unknown> };
}

interface Scene {
  elements: El[];
  appState: { viewBackgroundColor: string };
}

interface Pair {
  subject: string;
  /** "text" (4.5:1) or "mark" (3:1). */
  as: "text" | "mark";
  fg: string;
  bg: string;
  theme: Theme;
  ratio: number;
  board: string;
}

const AREA_TYPES = new Set(["rectangle", "ellipse", "diamond"]);

const contains = (outer: El, x0: number, y0: number, x1: number, y1: number) =>
  outer.x - 1 <= x0 &&
  outer.y - 1 <= y0 &&
  outer.x + outer.width + 1 >= x1 &&
  outer.y + outer.height + 1 >= y1;

/** The colour of the surface under the box, from the filled shapes drawn before `index`. */
function surface(scene: Scene, index: number, box: [number, number, number, number]): Rgb {
  for (let j = index - 1; j >= 0; j--) {
    const el = scene.elements[j] as El;
    if (el.isDeleted || !AREA_TYPES.has(el.type)) continue;
    const fill = parse(el.backgroundColor);
    if (fill === null || !contains(el, ...box)) continue;
    return over(fill, el.opacity / 100, surface(scene, j, box));
  }
  return parse(scene.appState.viewBackgroundColor) as Rgb;
}

function groupDepth(el: El): number {
  return el.groupIds.length + 1;
}

/** "cause node", "flow edge", "element button", "group depth 3", "legend", ... */
function subjectOf(el: El, byId: Map<string, El>): string {
  const gb = el.customData?.groundboard ?? {};
  const [prefix] = el.id.split("/");
  if (prefix === "group" || prefix === "group-label") return `group depth ${groupDepth(el)}`;
  if (/\/(spec|manual)$/.test(el.id)) return "spec tag";
  if (prefix === "ref-tag") return "ref tag";
  if (prefix === "ref-line") return "ref line";
  if (prefix === "row-tag") return `${String(gb.kind)} tag`;
  if (el.id.endsWith("/guard")) return "endpoint guard";
  if (el.id.endsWith("/unresolved")) return "unresolved marker";
  if (el.id.endsWith("/action")) return "action marker";
  if (/\/diag[12]$/.test(el.id)) return "image placeholder";
  if (prefix?.startsWith("legend") || el.id.includes("legend")) return "legend";
  if (prefix?.startsWith("title")) return el.id;
  if (el.type === "frame" && gb.groupId !== undefined) return "group depth 1";
  if (el.type === "arrow" && typeof gb.kind === "string") return `${gb.kind} edge`;
  if (gb.kind === "element") return `element ${String(gb.role)}`;
  if (gb.column !== undefined) return "table column";
  if (gb.kind === "job" && el.type !== "frame") return "job row";
  if (typeof gb.kind === "string") return `${gb.kind} node`;
  if (el.containerId) {
    const container = byId.get(el.containerId);
    if (container) return subjectOf(container, byId);
  }
  if (el.type === "text") return "free text";
  return el.id;
}

/** The colour pairs of a scene; adds the subject of every element to `drawn`. */
function pairsOf(board: string, scene: Scene, drawn: Set<string>): Pair[] {
  const pairs: Pair[] = [];
  const byId = new Map(scene.elements.map((e) => [e.id, e]));
  const add = (subject: string, as: Pair["as"], fg: Rgb, bg: Rgb, theme: Theme, label = "") => {
    const [f, b] = [inTheme(theme, fg), inTheme(theme, bg)];
    pairs.push({
      subject: label ? `${subject}: ${label}` : subject,
      as,
      fg: toHex(f),
      bg: toHex(b),
      theme,
      ratio: contrast(f, b),
      board,
    });
  };
  scene.elements.forEach((el, index) => {
    if (el.isDeleted) return;
    const subject = subjectOf(el, byId);
    drawn.add(subject);
    if (el.type === "frame") {
      // Frames sit on the canvas; Excalidraw draws their outline and name in its own colours,
      // whatever the frame stands for.
      const canvas = surface(scene, index, [el.x, el.y, el.x + el.width, el.y + el.height]);
      for (const theme of THEMES) {
        add("excalidraw frame", "mark", parse(FRAME_STROKE) as Rgb, canvas, theme, "outline");
        // The dark export draws the name in its dark colour, and the filter still applies.
        const name = parse(FRAME_NAME[theme]) as Rgb;
        if (el.name) add("excalidraw frame", "text", name, canvas, theme, "name");
      }
      return;
    }
    const alpha = el.opacity / 100;
    if (el.type === "text") {
      const ink = parse(el.strokeColor);
      if (ink === null) return;
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const bg = surface(scene, index, [cx, cy, cx, cy]);
      const label = el.containerId && byId.get(el.containerId)?.type === "arrow" ? "label" : "text";
      for (const theme of THEMES) add(subject, "text", over(ink, alpha, bg), bg, theme, label);
      return;
    }
    // A shape or line: its stroke, or its fill when it has no stroke, against what is under it.
    const mark = parse(el.strokeColor) ?? parse(el.backgroundColor);
    if (mark === null) return;
    const bg = surface(scene, index, [el.x, el.y, el.x + el.width, el.y + el.height]);
    const label = parse(el.strokeColor) === null ? "fill" : "stroke";
    for (const theme of THEMES) add(subject, "mark", over(mark, alpha, bg), bg, theme, label);
  });
  return pairs;
}

// ---------------------------------------------------------------------------------------------
// The boards: every example, and one board for what the examples do not draw

const repoRoot = path.resolve(import.meta.dirname, "../../..");

function exampleBoards(): { name: string; file: string; root: string }[] {
  const out: { name: string; file: string; root: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".board.json")) {
        const inAtlas = path.basename(dir) === ".groundboard";
        out.push({
          name: path.relative(repoRoot, full),
          file: full,
          root: inAtlas ? path.dirname(dir) : repoRoot,
        });
      }
    }
  };
  walk(path.join(repoRoot, "examples"));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Nested groups as deep as the schema allows (four levels), and every flow node and edge kind with a label. */
const coverageBoard = {
  schemaVersion: 1,
  title: "Every flow kind",
  question: "Does every kind stay legible in both themes?",
  groups: [
    { id: "g1", label: "Depth 1" },
    { id: "g2", label: "Depth 2", parentId: "g1" },
    { id: "g3", label: "Depth 3", parentId: "g2" },
    { id: "g4", label: "Depth 4", parentId: "g3" },
  ],
  nodes: [
    { id: "step", kind: "step", label: "A step", groupId: "g1", sourceIds: ["s"] },
    { id: "state", kind: "state", label: "A state", groupId: "g2", sourceIds: ["s"] },
    { id: "decision", kind: "decision", label: "A decision?", groupId: "g3", sourceIds: ["s"] },
    { id: "cause", kind: "cause", label: "A cause", groupId: "g4", sourceIds: ["s"] },
    { id: "fact", kind: "fact", label: "A fact", groupId: "g4", sourceIds: ["s"] },
    {
      id: "rejected",
      kind: "rejected",
      label: "A rejected option",
      groupId: "g4",
      sourceIds: ["s"],
    },
    { id: "question", kind: "question", label: "An open question (Product)", groupId: "g4" },
    { id: "note", kind: "note", label: "A note", groupId: "g4" },
    {
      id: "spec",
      kind: "step",
      label: "A step from the spec",
      groupId: "g4",
      sourceIds: ["d"],
    },
  ],
  edges: [
    { id: "e1", from: "step", to: "state", kind: "flow", label: "flow" },
    { id: "e2", from: "state", to: "decision", kind: "transition", label: "transition" },
    { id: "e3", from: "cause", to: "decision", kind: "causes", label: "causes" },
    { id: "e4", from: "question", to: "fact", kind: "blocks", label: "blocks" },
    { id: "e5", from: "rejected", to: "cause", kind: "relates", label: "relates" },
    { id: "e6", from: "fact", to: "spec", kind: "flow", label: "from the spec", sourceIds: ["d"] },
  ],
  sources: [
    {
      id: "s",
      path: "examples/fixtures/checkout/payment.ts",
      line: 21,
      quote: "const reserved = await reserveStock(cart.lines);",
    },
    { id: "d", kind: "doc", path: "docs/checkout.md", line: 1, quote: "Checkout" },
  ],
};

/** The claim edges the atlas examples draw only as refs to another board, between their nodes. */
const dataCoverageBoard = {
  schemaVersion: 1,
  title: "Every data edge",
  question: "Do data edges stay legible in both themes?",
  nodes: [
    { id: "cart", kind: "resource", label: "Cart", ref: "api:cart" },
    {
      id: "add",
      kind: "endpoint",
      label: "Add a line",
      parentId: "cart",
      method: "POST",
      path: "/cart/lines",
      ref: "api:cart/post-lines",
      sourceIds: ["s"],
      guards: [{ name: "requireCustomer", sourceIds: ["s"] }],
    },
    {
      id: "lines",
      kind: "table",
      label: "cart_lines",
      ref: "db:cart-lines",
      sourceIds: ["s"],
      columns: [{ name: "id", type: "uuid", pk: true }],
    },
    {
      id: "sync",
      kind: "job",
      label: "Sync stock",
      ref: "batch:sync-stock",
      trigger: { type: "queue", queue: "sync" },
      sourceIds: ["s"],
    },
    {
      id: "remove",
      kind: "endpoint",
      label: "Remove a line",
      parentId: "cart",
      method: "DELETE",
      path: "/cart/lines/:id",
      ref: "api:cart/delete-lines-id",
      sourceIds: ["s"],
      guards: [],
    },
    { id: "start", kind: "step", label: "Add to cart", sourceIds: ["s"] },
  ],
  edges: [
    { id: "calls", from: "start", to: "add", kind: "calls", label: "calls", sourceIds: ["s"] },
    { id: "writes", from: "add", to: "lines", kind: "writes", label: "writes", sourceIds: ["s"] },
    { id: "reads", from: "sync", to: "lines", kind: "reads", label: "reads", sourceIds: ["s"] },
    { id: "enq", from: "add", to: "sync", kind: "enqueues", label: "enqueues", sourceIds: ["s"] },
    // Drawn as tags in the endpoint's row.
    { id: "t-reads", from: "remove", toRef: "db:cart", kind: "reads", sourceIds: ["s"] },
    { id: "t-writes", from: "remove", toRef: "db:cart-lines", kind: "writes", sourceIds: ["s"] },
    { id: "t-enq", from: "remove", toRef: "batch:sync-stock", kind: "enqueues", sourceIds: ["s"] },
  ],
  sources: coverageBoard.sources.slice(0, 1),
};

let boards: { name: string; scene: Scene }[] = [];
let pairs: Pair[] = [];
/** Every subject the boards draw, with or without a colour pair to check. */
const drawn = new Set<string>();

const key = (p: Pair) => `${p.theme} | ${p.subject}`;
const minimum = (p: Pair) => (p.as === "text" ? MIN_TEXT : MIN_MARK);

beforeAll(async () => {
  const inputs: { name: string; input: unknown; root?: string }[] = exampleBoards().map((b) => ({
    name: b.name,
    input: JSON.parse(readFileSync(b.file, "utf8")),
    root: b.root,
  }));
  inputs.push({ name: "coverage board", input: coverageBoard });
  inputs.push({ name: "data coverage board", input: dataCoverageBoard });
  boards = [];
  for (const { name, input, root } of inputs) {
    const result = await renderBoard(input, {
      ...(root ? { checkSourcesRoot: root } : {}),
      onStaleSources: "render",
    });
    if (!result.scene) throw new Error(`${name}: ${JSON.stringify(result.issues)}`);
    boards.push({ name, scene: result.scene as unknown as Scene });
  }
  pairs = boards.flatMap((b) => pairsOf(b.name, b.scene, drawn));
}, 120_000);

describe("legibility of board colours in the PNG", () => {
  test("the dark PNG is the light colours through the theme filter, in sRGB", async () => {
    const dist = path.resolve(import.meta.dirname, "../dist/index.mjs");
    if (!existsSync(dist)) throw new Error(`${dist} is missing; run "pnpm -r build" first`);
    const png = (await import(dist)) as typeof import("../src/index.ts");
    const colors = [
      ...new Set(
        boards.flatMap((b) => b.scene.elements.flatMap((e) => [e.strokeColor, e.backgroundColor])),
      ),
    ]
      .filter((c) => c !== "transparent")
      .concat(FRAME_STROKE, FRAME_NAME.light, FRAME_NAME.dark)
      .sort();
    const elements = colors.map((color, i) =>
      shape("rectangle", {
        id: `swatch-${i}`,
        x: i * 60,
        y: 0,
        width: 50,
        height: 50,
        strokeColor: color,
        backgroundColor: color,
        roughness: 0,
      }),
    );
    const result = await png.renderPng(
      { elements, appState: { viewBackgroundColor: "#ffffff" } },
      { theme: "dark", maxEdge: 8000, minText: 1 },
    );
    const image = decodePng(result.tiles[0]?.png ?? new Uint8Array());
    // exportToSvg pads the board by 10 scene units.
    const at = (sx: number, sy: number) => {
      const x = Math.round((sx + 10) * result.scale);
      const y = Math.round((sy + 10) * result.scale);
      const i = (y * image.width + x) * 4;
      return [...image.data.subarray(i, i + 3)];
    };
    const off: string[] = [];
    colors.forEach((color, i) => {
      const drawn = at(i * 60 + 25, 25);
      const want = darkFilter(parse(color) as Rgb).map((v) => Math.round(v * 255));
      if (drawn.some((v, c) => Math.abs(v - (want[c] as number)) > 2)) {
        off.push(`${color}: drawn ${drawn.join(",")}, computed ${want.join(",")}`);
      }
    });
    expect(off, "dark colours the PNG draws that the computed filter does not predict").toEqual([]);
  });

  test("the boards draw every node kind, edge kind, element role and group depth", () => {
    const want = [
      ...NODE_KINDS.filter((k) => k !== "element").map((k) => `${k} node`),
      ...EDGE_KINDS.map((k) => `${k} edge`),
      ...ELEMENT_ROLES.map((r) => `element ${r}`),
      ...[1, 2, 3, 4].map((d) => `group depth ${d}`),
      "table column",
      "reads tag",
      "writes tag",
      "enqueues tag",
      "endpoint guard",
      "spec tag",
      "legend",
    ];
    expect(
      want.filter((s) => !drawn.has(s)),
      "kinds no board draws",
    ).toEqual([]);
  });

  test("text reaches 4.5:1 and strokes and shapes 3:1, in both themes", () => {
    // The lowest ratio of each subject per theme.
    const worst = new Map<string, Pair>();
    for (const p of pairs) {
      const prev = worst.get(key(p));
      if (!prev || p.ratio / minimum(p) < prev.ratio / minimum(prev)) worst.set(key(p), p);
    }
    const ratios = (list: Record<string, Accepted>) =>
      Object.fromEntries(Object.entries(list).map(([k, v]) => [k, v.ratio]));
    const lists: Record<string, Record<string, number>> = {
      KNOWN_SHORTFALLS,
      DECORATIVE: ratios(DECORATIVE),
      EXCALIDRAW_DRAWN: ratios(EXCALIDRAW_DRAWN),
    };
    const listed = (k: string) => Object.keys(lists).find((name) => lists[name]?.[k] !== undefined);
    if (process.env.LEGIBILITY_TABLE) {
      const rows = [...worst.values()].sort((a, b) => key(a).localeCompare(key(b)));
      const result = (p: Pair) =>
        p.ratio >= minimum(p) ? "pass" : `below, ${listed(key(p)) ?? "not listed"}`;
      console.log(
        rows
          .map(
            (p) =>
              `| ${p.subject} | ${p.theme} | ${p.fg} on ${p.bg} | ${p.ratio.toFixed(2)} | ${minimum(p)} | ${result(p)} |`,
          )
          .join("\n"),
      );
    }
    const describePair = (p: Pair) =>
      `${p.subject} (${p.theme} theme): ${p.fg} on ${p.bg} is ${p.ratio.toFixed(2)}:1, needs ${minimum(p)}:1 (${p.board})`;
    const failing = [...worst.values()].filter((p) => p.ratio < minimum(p));
    const unexpected = failing
      .filter((p) => {
        const name = listed(key(p));
        const allowed = name ? lists[name]?.[key(p)] : undefined;
        return allowed === undefined || p.ratio < allowed - 0.005;
      })
      .map(describePair);
    const stale = Object.entries(lists).flatMap(([name, list]) =>
      Object.keys(list)
        .filter((k) => !failing.some((p) => key(p) === k))
        .map((k) => `${name}: ${k}`),
    );
    expect(unexpected, "colour pairs below the WCAG threshold").toEqual([]);
    expect(stale, "listed as below the threshold but now legible or no longer drawn").toEqual([]);
  });
});
