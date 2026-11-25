import { createHash } from "node:crypto";
import {
  type Board,
  type BoardNode,
  type FigmaSource,
  owningScreen,
  screenFigmaSource,
  stateRoots,
} from "@groundboard/schema";
import type { RgbaImage } from "./png.ts";

/**
 * Change detection and layer boxes for the Figma reference cache, from the `get_metadata`
 * outline of a frame. Shared by `groundboard figma entry` (the MCP path) and, later,
 * `groundboard figma pull` (the REST path), so both write the same hashes for the same design.
 */

/** One layer of a frame's outline, positioned relative to its parent as Figma gives it. */
export interface FigmaLayer {
  id: string;
  /** The layer's type in lower case: the XML element name (`frame`, `instance`, `text`, …). */
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hidden: boolean;
  children: FigmaLayer[];
}

/** `[x, y, width, height]` relative to the frame's top-left corner. */
export type Box = [number, number, number, number];

export class MetadataError extends Error {}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, name: string) => {
    if (name.startsWith("#x")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return ENTITIES[name] ?? whole;
  });
}

const TAG =
  /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>/g;
const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function number(value: string | undefined): number {
  if (value === undefined) return 0;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Parses the XML `get_metadata` returns into its first top-level element. Text around and
 * between the elements is ignored, so the tool's answer can be saved verbatim; attributes may
 * come in any order, with any whitespace and either quote. Throws `MetadataError` on unbalanced
 * tags or when no element carries an `id`.
 */
export function parseMetadataXml(text: string): FigmaLayer {
  const roots: FigmaLayer[] = [];
  const stack: { tag: string; layer: FigmaLayer }[] = [];
  for (const match of text.matchAll(TAG)) {
    const [, closing, tag, attributeText, selfClosing] = match;
    if (tag === undefined) continue; // comment, declaration, CDATA
    if (closing === "/") {
      const open = stack.pop();
      if (open?.tag !== tag) throw new MetadataError(`unexpected </${tag}>`);
      if (stack.length === 0 && roots.length > 0) break;
      continue;
    }
    const attributes: Record<string, string> = {};
    for (const attribute of (attributeText ?? "").matchAll(ATTRIBUTE)) {
      const [, key = "", doubleQuoted, singleQuoted] = attribute;
      attributes[key] = decodeEntities(doubleQuoted ?? singleQuoted ?? "");
    }
    const layer: FigmaLayer = {
      id: attributes.id ?? "",
      type: tag.toLowerCase(),
      name: attributes.name ?? "",
      x: number(attributes.x),
      y: number(attributes.y),
      width: number(attributes.width),
      height: number(attributes.height),
      hidden: attributes.hidden === "true" || attributes.visible === "false",
      children: [],
    };
    const parent = stack.at(-1);
    if (parent) parent.layer.children.push(layer);
    else roots.push(layer);
    if (selfClosing !== "/") stack.push({ tag, layer });
    else if (stack.length === 0) break;
  }
  if (stack.length > 0) throw new MetadataError(`<${stack.at(-1)?.tag}> is never closed`);
  const root = roots[0];
  if (root === undefined || root.id === "")
    throw new MetadataError("holds no element with an id; save the get_metadata answer verbatim");
  return root;
}

function* walk(layer: FigmaLayer): Generator<FigmaLayer> {
  yield layer;
  for (const child of layer.children) yield* walk(child);
}

function findLayer(root: FigmaLayer, id: string): FigmaLayer | undefined {
  for (const layer of walk(root)) if (layer.id === id) return layer;
  return undefined;
}

/**
 * The frame's outline with the layers of each instance placed under that instance. An instance
 * outline's root must be a layer of the frame or of another instance outline; its children
 * replace whatever the frame showed of that instance. The result does not depend on the order
 * the instance outlines are given in.
 */
export function mergeInstances(frame: FigmaLayer, instances: readonly FigmaLayer[]): FigmaLayer {
  const merged = structuredClone(frame);
  const seen = new Set<string>();
  for (const instance of instances) {
    if (instance.id === frame.id)
      throw new MetadataError(`instance outline ${instance.id} is the frame itself`);
    if (seen.has(instance.id))
      throw new MetadataError(`instance ${instance.id} is given more than once`);
    seen.add(instance.id);
  }
  let pending = [...instances];
  while (pending.length > 0) {
    const left = pending.filter((instance) => {
      const target = findLayer(merged, instance.id);
      if (target === undefined) return true;
      target.children = structuredClone(instance.children);
      return false;
    });
    if (left.length === pending.length) {
      const ids = left.map((instance) => instance.id).join(", ");
      throw new MetadataError(
        `instance outline(s) ${ids} are not a layer of the frame or of another instance outline`,
      );
    }
    pending = left;
  }
  return merged;
}

/** A coordinate written with at most two decimals; `-0` written `0`. */
function rounded(value: number): number {
  const result = Math.round(value * 100) / 100;
  return Object.is(result, -0) ? 0 : result;
}

/**
 * One line per layer in document order: `[id, type, name, x, y, width, height, hidden]` as JSON,
 * numbers with at most two decimals. The frame's own position on the canvas is written as 0, so
 * moving the whole frame is not a design change.
 */
export function canonicalOutline(frame: FigmaLayer): string {
  const lines: string[] = [];
  for (const layer of walk(frame)) {
    const isFrame = layer === frame;
    lines.push(
      JSON.stringify([
        layer.id,
        layer.type,
        layer.name,
        isFrame ? 0 : rounded(layer.x),
        isFrame ? 0 : rounded(layer.y),
        rounded(layer.width),
        rounded(layer.height),
        layer.hidden ? 1 : 0,
      ]),
    );
  }
  return `${lines.join("\n")}\n`;
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/** SHA-256 of the canonical outline: changes when a layer is added, removed, moved, resized, hidden or renamed. */
export function contentHash(frame: FigmaLayer): string {
  return sha256(canonicalOutline(frame));
}

/** SHA-256 of the size and the decoded RGBA pixels, so re-encoding the same image keeps it. */
export function pixelHash(image: RgbaImage): string {
  return createHash("sha256")
    .update(`${image.width}x${image.height}\n`)
    .update(image.data)
    .digest("hex");
}

/** How far apart two coordinates may be and still count as the same edge. */
const EDGE_TOLERANCE = 0.5;

/**
 * Whether a layer is a group. `get_metadata` writes a group as `<frame>`, but a group has no
 * coordinate space of its own: its children's `x`/`y` are in the same space as the group's, and
 * its box is exactly the union of theirs. A frame's children are relative to the frame, so their
 * union coincides with the frame's own box only by accident (checked on a real file: 24 of 25
 * groups found among 9,560 layers with children, none wrongly; the one missed holds rotated
 * vectors, whose `x`/`y` are not their bounds). A layer at (0, 0) reads the same either way.
 */
export function isGroupLayer(layer: FigmaLayer): boolean {
  if (layer.type === "group") return true;
  if (layer.type !== "frame" || layer.children.length === 0) return false;
  if (Math.abs(layer.x) <= EDGE_TOLERANCE && Math.abs(layer.y) <= EDGE_TOLERANCE) return false;
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const child of layer.children) {
    left = Math.min(left, child.x);
    top = Math.min(top, child.y);
    right = Math.max(right, child.x + child.width);
    bottom = Math.max(bottom, child.y + child.height);
  }
  const own = [layer.x, layer.y, layer.x + layer.width, layer.y + layer.height];
  return [left, top, right, bottom].every(
    (edge, i) => Math.abs(edge - (own[i] ?? 0)) <= EDGE_TOLERANCE,
  );
}

/**
 * Visits every layer with its position relative to the frame's top-left corner. Each layer's
 * `x`/`y` are relative to the space it sits in: its parent's, or, under a group, the group's
 * own space (groups nest). The frame itself is at (0, 0) whatever its place on the canvas.
 */
function walkPositioned(
  frame: FigmaLayer,
  visit: (layer: FigmaLayer, x: number, y: number) => boolean | undefined,
): void {
  const step = (layer: FigmaLayer, baseX: number, baseY: number) => {
    const x = baseX + layer.x;
    const y = baseY + layer.y;
    if (visit(layer, x, y) === false) return;
    const [childX, childY] = isGroupLayer(layer) ? [baseX, baseY] : [x, y];
    for (const child of layer.children) step(child, childX, childY);
  };
  step(frame, -frame.x, -frame.y);
}

/** The box of every layer of the frame relative to its top-left corner, the frame's own included. */
export function layerBoxes(frame: FigmaLayer): Map<string, Box> {
  const boxes = new Map<string, Box>();
  walkPositioned(frame, (layer, x, y) => {
    if (!boxes.has(layer.id))
      boxes.set(layer.id, [rounded(x), rounded(y), rounded(layer.width), rounded(layer.height)]);
    return true;
  });
  return boxes;
}

export type Origin = { ok: true; x: number; y: number } | { ok: false; reason: string };

/**
 * Where the frame's top-left corner lies inside its image. On an axis where the image has the
 * frame's size it is 0, whatever layers poke past the frame's edges (the frame clips them).
 * Otherwise the extra pixels come from layers overflowing the frame, or from effects (shadows)
 * of layers at its edges: when the overflow of the visible layers accounts for them exactly, it
 * gives the origin; when no layer reaches the near edge, nothing can push the frame in, so 0;
 * when no layer reaches the far edge, all of it is on the near side. Anything else is ambiguous.
 */
export function frameOrigin(frame: FigmaLayer, image: { width: number; height: number }): Origin {
  const visible: Box[] = [];
  walkPositioned(frame, (layer, x, y) => {
    if (layer.hidden) return false;
    if (layer !== frame && !isGroupLayer(layer)) visible.push([x, y, layer.width, layer.height]);
    return true;
  });
  const axis = (name: "x" | "y", imageSize: number, frameSize: number, at: 0 | 1) => {
    const extra = imageSize - Math.round(frameSize);
    if (extra === 0) return { ok: true as const, value: 0 };
    const side = name === "x" ? "wide" : "tall";
    if (extra < 0)
      return {
        ok: false as const,
        reason: `the image is ${imageSize}px ${side} but the frame ${frameSize}px: it was scaled down; fetch it again at full size`,
      };
    const starts = visible.map((box) => box[at]);
    const ends = visible.map((box) => box[at] + (at === 0 ? box[2] : box[3]));
    const least = starts.reduce((a, b) => Math.min(a, b), 0);
    const most = ends.reduce((a, b) => Math.max(a, b), frameSize);
    const before = Math.max(0, Math.round(-least));
    const after = Math.max(0, Math.round(most - frameSize));
    if (before + after === extra) return { ok: true as const, value: before };
    const touchesNear = starts.some((start) => start <= 0);
    const touchesFar = ends.some((end) => end >= frameSize);
    if (!touchesNear) return { ok: true as const, value: 0 };
    if (!touchesFar) return { ok: true as const, value: extra };
    const [near, far] = name === "x" ? ["left", "right"] : ["top", "bottom"];
    return {
      ok: false as const,
      reason: `the image is ${extra}px ${name === "x" ? "wider" : "taller"} than the frame and layers reach both its ${near} and ${far} edges, so the extra pixels cannot be placed`,
    };
  };
  const x = axis("x", image.width, frame.width, 0);
  const y = axis("y", image.height, frame.height, 1);
  if (!x.ok) return x;
  if (!y.ok) return y;
  return { ok: true, x: x.value, y: y.value };
}

/** The screens of a board drawn from a Figma node, and the layers their elements cite. */
export interface CitedLayers {
  /** The figma source of the screen(s) drawn from the frame. */
  frame: FigmaSource;
  screenIds: string[];
  /** Figma node id → ids of the elements citing it, in board order. */
  layers: Map<string, string[]>;
}

/**
 * The layers cited by the elements of every screen drawn from the Figma node `frameNodeId`: the
 * screen that cites it, and states without a frame of their own whose root cites it. Only figma
 * sources in the frame's file count. `undefined` when no screen cites that node.
 */
export function citedLayers(board: Board, frameNodeId: string): CitedLayers | undefined {
  const sources = new Map(board.sources.map((s) => [s.id, s]));
  const byId = new Map<string, BoardNode>();
  for (const node of board.nodes) if (!byId.has(node.id)) byId.set(node.id, node);
  const roots = stateRoots(board);
  const frameOf = (screen: BoardNode): FigmaSource | undefined => {
    const own = screenFigmaSource(screen, sources);
    if (own !== undefined) return own;
    const root = byId.get(roots.get(screen.id) ?? "");
    return root === undefined ? undefined : screenFigmaSource(root, sources);
  };
  const screens = board.nodes.filter(
    (node) => node.kind === "screen" && frameOf(node)?.nodeId === frameNodeId,
  );
  const first = screens[0];
  const frame = first === undefined ? undefined : frameOf(first);
  if (frame === undefined) return undefined;
  const screenIds = new Set(screens.map((screen) => screen.id));
  const layers = new Map<string, string[]>();
  for (const node of board.nodes) {
    if (node.kind !== "element") continue;
    const screen = owningScreen(node.id, byId);
    if (screen === undefined || !screenIds.has(screen.id)) continue;
    for (const sourceId of node.sourceIds) {
      const source = sources.get(sourceId);
      if (source?.kind !== "figma" || source.fileKey !== frame.fileKey) continue;
      const ids = layers.get(source.nodeId) ?? [];
      if (!ids.includes(node.id)) ids.push(node.id);
      layers.set(source.nodeId, ids);
    }
  }
  return { frame, screenIds: [...screenIds], layers };
}
