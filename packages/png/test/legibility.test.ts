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
 * Pairs below the threshold today, by "theme | subject", with the ratio measured when the entry
 * was written. The palette is shared with the viewer, so a change to it is a decision of its
 * own; until then these stay listed, and the test fails when one gets worse, when a new pair
 * falls short, or when a listed pair starts passing (remove it then).
 */
const KNOWN_SHORTFALLS: Record<string, number> = {
  "dark | element bar: stroke": 1.33,
  "dark | element container: stroke": 2.42,
  "dark | element container: text": 4.02,
  "dark | element image: stroke": 1.52,
  "dark | element image: text": 3.83,
  "dark | element input: text": 4.02,
  "dark | group depth 1: frame outline": 2.2,
  "dark | group depth 2: stroke": 2.42,
  "dark | group depth 3: stroke": 2.31,
  "dark | group depth 4: stroke": 2.19,
  "dark | job node: frame outline": 2.2,
  "dark | job node: stroke": 1.59,
  "dark | legend: frame outline": 2.2,
  "dark | rejected node: text": 3.63,
  "dark | relates edge: label": 3.38,
  "dark | resource node: frame outline": 2.2,
  "dark | screen node: frame outline": 2.2,
  "dark | screen node: text": 4.02,
  "dark | table column: stroke": 1.59,
  "dark | table node: frame outline": 2.2,
  "dark | unresolved marker: text": 3.57,
  "light | element bar: stroke": 1.3,
  "light | element container: stroke": 2.07,
  "light | element container: text": 3.32,
  "light | element image: stroke": 1.42,
  "light | element image: text": 3.15,
  "light | element input: text": 3.32,
  "light | group depth 1: frame name": 2.85,
  "light | group depth 1: frame outline": 1.92,
  "light | group depth 2: stroke": 2.07,
  "light | group depth 3: stroke": 1.97,
  "light | group depth 4: stroke": 1.87,
  "light | job node: frame name": 2.85,
  "light | job node: frame outline": 1.92,
  "light | job node: stroke": 1.49,
  "light | legend: frame name": 2.85,
  "light | legend: frame outline": 1.92,
  "light | legend: stroke": 2.48,
  "light | question node: stroke": 2.09,
  "light | rejected node: stroke": 2.8,
  "light | rejected node: text": 2.99,
  "light | relates edge: label": 2.8,
  "light | relates edge: stroke": 2.8,
  "light | resource node: frame name": 2.85,
  "light | resource node: frame outline": 1.92,
  "light | screen node: frame name": 2.85,
  "light | screen node: frame outline": 1.92,
  "light | screen node: text": 3.32,
  "light | spec tag: text": 4.23,
  "light | table column: stroke": 1.49,
  "light | table node: frame name": 2.85,
  "light | table node: frame outline": 1.92,
  "light | title-figma: text": 3.58,
  "light | title-grounding: text": 3.58,
  "light | title-status: text": 3.45,
  "light | unresolved marker: text": 2.09,
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
  if (el.id.endsWith("/unresolved")) return "unresolved marker";
  if (el.id.endsWith("/action")) return "action marker";
  if (prefix?.startsWith("legend") || el.id.includes("legend")) return "legend";
  if (prefix?.startsWith("title")) return el.id;
  if (el.type === "frame" && gb.groupId !== undefined) return "group depth 1";
  if (el.type === "arrow" && typeof gb.kind === "string") return `${gb.kind} edge`;
  if (gb.kind === "element") return `element ${String(gb.role)}`;
  if (gb.column !== undefined) return "table column";
  if (typeof gb.kind === "string") return `${gb.kind} node`;
  if (el.containerId) {
    const container = byId.get(el.containerId);
    if (container) return subjectOf(container, byId);
  }
  if (el.type === "text") return "free text";
  return el.id;
}

function pairsOf(board: string, scene: Scene): Pair[] {
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
    if (el.type === "frame") {
      // Frames sit on the canvas; Excalidraw draws their outline and name in its own colours.
      const canvas = surface(scene, index, [el.x, el.y, el.x + el.width, el.y + el.height]);
      for (const theme of THEMES) {
        add(subject, "mark", parse(FRAME_STROKE) as Rgb, canvas, theme, "frame outline");
        // The dark export draws the name in its dark colour, and the filter still applies.
        const name = parse(FRAME_NAME[theme]) as Rgb;
        if (el.name) add(subject, "text", name, canvas, theme, "frame name");
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
    { id: "start", kind: "step", label: "Add to cart", sourceIds: ["s"] },
  ],
  edges: [
    { id: "calls", from: "start", to: "add", kind: "calls", label: "calls", sourceIds: ["s"] },
    { id: "writes", from: "add", to: "lines", kind: "writes", label: "writes", sourceIds: ["s"] },
    { id: "reads", from: "sync", to: "lines", kind: "reads", label: "reads", sourceIds: ["s"] },
    { id: "enq", from: "add", to: "sync", kind: "enqueues", label: "enqueues", sourceIds: ["s"] },
  ],
  sources: coverageBoard.sources.slice(0, 1),
};

let boards: { name: string; scene: Scene }[] = [];
let pairs: Pair[] = [];

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
  pairs = boards.flatMap((b) => pairsOf(b.name, b.scene));
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
    const seen = new Set(pairs.map((p) => p.subject.split(":")[0]));
    const want = [
      ...NODE_KINDS.filter((k) => k !== "element").map((k) => `${k} node`),
      ...EDGE_KINDS.map((k) => `${k} edge`),
      ...ELEMENT_ROLES.map((r) => `element ${r}`),
      ...[1, 2, 3, 4].map((d) => `group depth ${d}`),
      "table column",
      "spec tag",
      "legend",
    ];
    expect(
      want.filter((s) => !seen.has(s)),
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
    if (process.env.LEGIBILITY_TABLE) {
      const rows = [...worst.values()].sort((a, b) => key(a).localeCompare(key(b)));
      console.log(
        rows
          .map(
            (p) =>
              `| ${p.subject} | ${p.theme} | ${p.fg} on ${p.bg} | ${p.ratio.toFixed(2)} | ${minimum(p)} | ${p.ratio >= minimum(p) ? "pass" : "FAIL"} |`,
          )
          .join("\n"),
      );
    }
    const describePair = (p: Pair) =>
      `${p.subject} (${p.theme} theme): ${p.fg} on ${p.bg} is ${p.ratio.toFixed(2)}:1, needs ${minimum(p)}:1 (${p.board})`;
    const failing = [...worst.values()].filter((p) => p.ratio < minimum(p));
    const unexpected = failing
      .filter((p) => {
        const known = KNOWN_SHORTFALLS[key(p)];
        return known === undefined || p.ratio < known - 0.005;
      })
      .map(describePair);
    const fixed = Object.keys(KNOWN_SHORTFALLS).filter((k) => !failing.some((p) => key(p) === k));
    expect(unexpected, "colour pairs below the WCAG threshold").toEqual([]);
    expect(fixed, "listed in KNOWN_SHORTFALLS but now legible or no longer drawn").toEqual([]);
  });
});
