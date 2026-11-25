import { NOTE_TYPES, type Overlay, type OverlayNote, placedUnits } from "@groundboard/schema";

/**
 * Layout editing on the canvas: which boxes a person may drag, and what the canvas says about
 * the overlay once they have. Elements stay opaque records here, as the scene keeps them.
 */

type Element = Record<string, unknown>;

const NODE_PREFIX = "node/";
const NOTE_PREFIX = "note/";

const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const live = (elements: readonly unknown[]): Element[] =>
  elements.filter(
    (e): e is Element => typeof e === "object" && e !== null && (e as Element).isDeleted !== true,
  );

/** Whether an element is a note of the overlay: the renderer marks the notes it draws. */
export function isOverlayNote(element: Element): boolean {
  const data = element.customData as { groundboard?: { overlay?: unknown } } | undefined;
  return data?.groundboard?.overlay === true;
}

/** The ids of the units a board can move: top-level nodes and roots of screens with states. */
export function movableUnits(board: Record<string, unknown>): Set<string> {
  const nodes = Array.isArray(board.nodes) ? (board.nodes as never[]) : [];
  const units = placedUnits({ nodes });
  return new Set([...units].filter(([id, unit]) => id === unit).map(([id]) => id));
}

/** Ids of the elements the renderer drew, notes left out: everything else was drawn by hand. */
export function rendererIds(elements: readonly unknown[]): Set<string> {
  return new Set(
    live(elements)
      .filter((e) => !isOverlayNote(e))
      .map((e) => str(e.id))
      .filter((id): id is string => id !== undefined),
  );
}

/**
 * The scene locked for layout editing: only the boxes of movable units (and their own labels)
 * and the notes can be picked up; elements of a screen, states, arrows and the legend cannot.
 * The returned map holds each element's own `locked`, to put back afterwards.
 */
export function lockForLayout(
  elements: readonly unknown[],
  units: ReadonlySet<string>,
  drawn: ReadonlySet<string>,
): { elements: Element[]; locked: Map<string, unknown> } {
  const movable = new Set([...units].map((u) => `${NODE_PREFIX}${u}`));
  const locked = new Map<string, unknown>();
  const out = live(elements).map((element) => {
    const id = str(element.id) ?? "";
    locked.set(id, element.locked);
    const free =
      movable.has(id) ||
      movable.has(str(element.containerId) ?? "") ||
      !drawn.has(id) ||
      isOverlayNote(element);
    return free === !(element.locked === true) ? element : { ...element, locked: !free };
  });
  return { elements: out, locked };
}

/** The scene with every element's own `locked` back, as before editing; unlocked if unknown. */
export function unlockAfterLayout(
  elements: readonly unknown[],
  locked: ReadonlyMap<string, unknown>,
): Element[] {
  return live(elements).map((element) => {
    const id = str(element.id) ?? "";
    // An element the lock never saw was rendered during editing, unlocked by the renderer.
    const was = locked.get(id) === true;
    return (element.locked === true) === was ? element : { ...element, locked: was };
  });
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const boxOf = (e: Element): Box => ({
  x: num(e.x),
  y: num(e.y),
  width: num(e.width),
  height: num(e.height),
});

const contains = (box: Box, x: number, y: number) =>
  x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;

const round = (n: number) => Math.round(n * 100) / 100;
const NOTE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A note's id from its element's id: `note/<id>` for a note drawn before, else the element's own. */
function noteIdOf(elementId: string, taken: Set<string>): string {
  let id = elementId.startsWith(NOTE_PREFIX) ? elementId.slice(NOTE_PREFIX.length) : elementId;
  if (!NOTE_ID.test(id)) id = id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64) || "note";
  let unique = id;
  for (let n = 2; taken.has(unique); n += 1) unique = `${id.slice(0, 60)}-${n}`;
  taken.add(unique);
  return unique;
}

const COLOR = /^(?:#[0-9a-fA-F]{3,8}|transparent)$/;
const FILLS = new Set(["hachure", "cross-hatch", "solid", "zigzag"]);
const STROKES = new Set(["solid", "dashed", "dotted"]);
const NOTE_TYPE_SET = new Set<string>(NOTE_TYPES);

/** The checked fields of a drawn element as a note; null for a type a note cannot be. */
function toNote(element: Element, id: string): OverlayNote | null {
  const type = str(element.type);
  if (type === undefined || !NOTE_TYPE_SET.has(type)) return null;
  const note: OverlayNote = {
    id,
    type: type as OverlayNote["type"],
    x: round(num(element.x)),
    y: round(num(element.y)),
    width: round(Math.max(0, num(element.width))),
    height: round(Math.max(0, num(element.height))),
  };
  const angle = num(element.angle);
  if (angle !== 0) note.angle = angle;
  const stroke = str(element.strokeColor);
  if (stroke && COLOR.test(stroke)) note.strokeColor = stroke;
  const background = str(element.backgroundColor);
  if (background && COLOR.test(background)) note.backgroundColor = background;
  const fill = str(element.fillStyle);
  if (fill && FILLS.has(fill)) note.fillStyle = fill as OverlayNote["fillStyle"];
  const width = num(element.strokeWidth);
  if (width >= 0.5 && width <= 20) note.strokeWidth = width;
  const strokeStyle = str(element.strokeStyle);
  if (strokeStyle && STROKES.has(strokeStyle)) {
    note.strokeStyle = strokeStyle as OverlayNote["strokeStyle"];
  }
  if (typeof element.roughness === "number")
    note.roughness = Math.min(2, Math.max(0, element.roughness));
  if (typeof element.opacity === "number")
    note.opacity = Math.min(100, Math.max(0, element.opacity));
  if (
    Array.isArray(element.points) &&
    (type === "arrow" || type === "line" || type === "freedraw")
  ) {
    note.points = (element.points as unknown[])
      .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2)
      .slice(0, 5000)
      .map(([px, py]) => [round(num(px)), round(num(py))] as [number, number]);
  }
  if (type === "text") {
    note.text = (str(element.originalText) ?? str(element.text) ?? "").slice(0, 2000);
    const size = num(element.fontSize);
    if (size >= 4 && size <= 200) note.fontSize = size;
  }
  return note;
}

export interface CollectInput {
  /** The scene as rendered, with the overlay of `base` applied. */
  rendered: readonly unknown[];
  /** The scene now. */
  current: readonly unknown[];
  units: ReadonlySet<string>;
  /** The overlay the rendered scene was drawn with. */
  base: Overlay;
}

/**
 * The overlay the canvas now shows. A unit's offset is its offset in `base` plus how far its
 * box was dragged since; an offset of zero is left out. Notes are the elements the renderer did
 * not draw (and the notes it drew, which may have moved), each anchored to the unit whose box
 * holds its centre. Elements a note cannot be (images, embeds, frames) are counted in `dropped`.
 */
export function collectOverlay(input: CollectInput): { overlay: Overlay; dropped: number } {
  const rendered = new Map(live(input.rendered).map((e) => [str(e.id) ?? "", e]));
  const current = live(input.current);
  const byId = new Map(current.map((e) => [str(e.id) ?? "", e]));
  const drawn = rendererIds(input.rendered);

  const nodes: Overlay["nodes"] = {};
  const unitBoxes: Array<[string, Box]> = [];
  for (const unit of input.units) {
    const was = rendered.get(`${NODE_PREFIX}${unit}`);
    const now = byId.get(`${NODE_PREFIX}${unit}`);
    if (!was || !now) {
      const kept = input.base.nodes[unit];
      if (kept) nodes[unit] = kept;
      continue;
    }
    unitBoxes.push([unit, boxOf(now)]);
    const dx = round((input.base.nodes[unit]?.dx ?? 0) + num(now.x) - num(was.x));
    const dy = round((input.base.nodes[unit]?.dy ?? 0) + num(now.y) - num(was.y));
    if (dx !== 0 || dy !== 0) nodes[unit] = { dx, dy };
  }

  const notes: OverlayNote[] = [];
  const taken = new Set<string>();
  let dropped = 0;
  for (const element of current) {
    const id = str(element.id) ?? "";
    if (drawn.has(id) && !isOverlayNote(element)) continue;
    const note = toNote(element, noteIdOf(id, taken));
    if (!note) {
      dropped += 1;
      continue;
    }
    const cx = note.x + note.width / 2;
    const cy = note.y + note.height / 2;
    const holder = unitBoxes.find(([, box]) => contains(box, cx, cy));
    if (holder) {
      const [nodeId, box] = holder;
      note.anchor = { nodeId, dx: round(note.x - box.x), dy: round(note.y - box.y) };
    }
    notes.push(note);
  }
  return { overlay: { schemaVersion: 1, nodes, notes }, dropped };
}
