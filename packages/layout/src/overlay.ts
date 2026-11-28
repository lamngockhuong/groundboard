import { type Board, type Overlay, placedUnits } from "@groundboard/schema";
import type {
  LaidOutBoard,
  LaidOutEdge,
  LaidOutGroup,
  LaidOutNode,
  LaidOutRefMarker,
  LaidOutText,
  PlacedNote,
  Point,
} from "./types.ts";

export type { PlacedNote };

export interface OverlayResult {
  laidOut: LaidOutBoard;
  notes: PlacedNote[];
  /** Overlay entries that match nothing on the board, and moved boxes that overlap others. */
  warnings: string[];
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Delta {
  dx: number;
  dy: number;
}

const round = (n: number) => Math.round(n * 100) / 100;
const BOARD_PADDING = 20;

const shiftPoint = ([x, y]: Point, d: Delta): Point => [round(x + d.dx), round(y + d.dy)];
const shiftBox = <T extends Box>(box: T, d: Delta): T => ({
  ...box,
  x: round(box.x + d.dx),
  y: round(box.y + d.dy),
});
const sameDelta = (a: Delta | undefined, b: Delta | undefined) =>
  (a?.dx ?? 0) === (b?.dx ?? 0) && (a?.dy ?? 0) === (b?.dy ?? 0);

function bounds(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Where the segment from the centre of `box` towards `toward` leaves the box. */
function borderPoint(box: Box, toward: Point): Point {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = toward[0] - cx;
  const dy = toward[1] - cy;
  if (dx === 0 && dy === 0) return [round(cx), round(cy)];
  const sx = dx === 0 ? Number.POSITIVE_INFINITY : box.width / 2 / Math.abs(dx);
  const sy = dy === 0 ? Number.POSITIVE_INFINITY : box.height / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return [round(cx + dx * s), round(cy + dy * s)];
}

const centre = (box: Box): Point => [box.x + box.width / 2, box.y + box.height / 2];

/**
 * Applies a layout overlay to a laid-out board. Each moved unit (a top-level node, or the root
 * of a screen with states) is shifted by its offset together with everything that belongs to
 * it: its elements, states, the tags and list lines of its markers and its reference images.
 * An edge whose two ends moved alike is shifted whole; an edge with one end moved is drawn
 * straight between the two boxes, its label at the middle. Groups and the board's size are
 * computed again. Anchored notes follow their node.
 */
export function applyOverlay(laidOut: LaidOutBoard, board: Board, overlay: Overlay): OverlayResult {
  const warnings: string[] = [];
  const units = placedUnits(board);
  // A row that is no board node (a table's column) moves with the card it sits in.
  const cardOf = new Map(
    laidOut.nodes
      .filter((n) => !units.has(n.id) && n.screenId)
      .map((n) => [n.id, n.screenId as string]),
  );
  const unitOf = (id: string) => units.get(id) ?? units.get(cardOf.get(id) ?? "") ?? id;
  const laidIds = new Set(laidOut.nodes.map((n) => n.id));

  const moved = new Map<string, Delta>();
  for (const [id, delta] of Object.entries(overlay.nodes)) {
    const isUnit = laidIds.has(id) && unitOf(id) === id;
    if (!isUnit) {
      warnings.push(
        units.has(id)
          ? `overlay: \`${id}\` moves with \`${unitOf(id)}\`; its own offset is ignored`
          : `overlay: \`${id}\` is not on the board; its offset is ignored`,
      );
      continue;
    }
    if (delta.dx !== 0 || delta.dy !== 0) moved.set(id, delta);
  }
  const deltaOf = (nodeId: string) => moved.get(unitOf(nodeId));

  const nodes: LaidOutNode[] = laidOut.nodes.map((node) => {
    const d = deltaOf(node.id);
    if (!d) return node;
    const out = shiftBox(node, d);
    if (node.textX !== undefined) out.textX = round(node.textX + d.dx);
    if (node.textY !== undefined) out.textY = round(node.textY + d.dy);
    if (node.rowParts !== undefined) {
      out.rowParts = { tags: node.rowParts.tags.map((tag) => shiftBox(tag, d)) };
      if (node.rowParts.guard !== undefined) out.rowParts.guard = shiftBox(node.rowParts.guard, d);
    }
    return out;
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const shiftText = (text: LaidOutText, d: Delta): LaidOutText => shiftBox(text, d);
  const shiftMarker = (marker: LaidOutRefMarker): LaidOutRefMarker => {
    const d = deltaOf(marker.screenId);
    return d
      ? { ...marker, tag: shiftText(marker.tag, d), line: shiftText(marker.line, d) }
      : marker;
  };

  const edges: LaidOutEdge[] = laidOut.edges.map((edge) => {
    if (edge.marker) return { ...edge, marker: shiftMarker(edge.marker) };
    // A tag moves with its row, which carries it in `rowParts`.
    if (edge.inRow) return edge;
    const from = deltaOf(edge.from);
    const to = deltaOf(edge.to);
    if (!from && !to) return edge;
    if (sameDelta(from, to)) {
      const d = from as Delta;
      const out: LaidOutEdge = { ...edge, points: edge.points.map((p) => shiftPoint(p, d)) };
      if (edge.label) out.label = shiftBox(edge.label, d);
      return out;
    }
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b) return edge;
    const start = borderPoint(a, centre(b));
    const end = borderPoint(b, centre(a));
    const out: LaidOutEdge = { ...edge, points: [start, end] };
    if (edge.label) {
      out.label = {
        ...edge.label,
        x: round((start[0] + end[0]) / 2 - edge.label.width / 2),
        y: round((start[1] + end[1]) / 2 - edge.label.height / 2),
      };
    }
    return out;
  });

  const references = laidOut.references?.map((reference) => {
    const d = deltaOf(reference.screenId);
    return d
      ? {
          ...reference,
          image: shiftBox(reference.image, d),
          border: shiftBox(reference.border, d),
          caption: shiftBox(reference.caption, d),
        }
      : reference;
  });

  // Groups fit their members again, keeping the margins the layout gave them; inner groups first.
  const original = new Map(laidOut.nodes.map((n) => [n.id, n]));
  const groups = new Map(laidOut.groups.map((g) => [g.id, g]));
  const ordered = [...laidOut.groups].sort((a, b) => b.depth - a.depth);
  for (const group of ordered) {
    const members = (source: (id: string) => Box | undefined, groupBox: (id: string) => Box) => [
      ...laidOut.nodes.filter((n) => n.groupId === group.id).map((n) => source(n.id) as Box),
      ...laidOut.groups.filter((g) => g.parentId === group.id).map((g) => groupBox(g.id)),
    ];
    const before = bounds(
      members(
        (id) => original.get(id),
        (id) => laidOut.groups.find((g) => g.id === id) as LaidOutGroup,
      ),
    );
    const after = bounds(
      members(
        (id) => byId.get(id),
        (id) => groups.get(id) as LaidOutGroup,
      ),
    );
    if (!before || !after) continue;
    if (
      before.x === after.x &&
      before.y === after.y &&
      before.width === after.width &&
      before.height === after.height
    ) {
      continue;
    }
    const left = before.x - group.x;
    const top = before.y - group.y;
    const right = group.x + group.width - (before.x + before.width);
    const bottom = group.y + group.height - (before.y + before.height);
    groups.set(group.id, {
      ...group,
      x: round(after.x - left),
      y: round(after.y - top),
      width: round(after.width + left + right),
      height: round(after.height + top + bottom),
    });
  }

  const notes: PlacedNote[] = overlay.notes.map((note) => {
    if (!note.anchor) return note;
    const anchor = byId.get(note.anchor.nodeId);
    if (!anchor) {
      warnings.push(
        `overlay: note \`${note.id}\` follows \`${note.anchor.nodeId}\`, which is not on the board; it stays where it was drawn`,
      );
      return note;
    }
    return { ...note, x: round(anchor.x + note.anchor.dx), y: round(anchor.y + note.anchor.dy) };
  });

  // A moved box that now covers another box is worth a look: the layout no longer keeps them apart.
  const unitBoxes = new Map<string, Box>();
  for (const node of nodes) {
    const unit = unitOf(node.id);
    const box = bounds([unitBoxes.get(unit), node].filter((b): b is Box => b !== undefined));
    if (box) unitBoxes.set(unit, box);
  }
  for (const unit of moved.keys()) {
    const box = unitBoxes.get(unit) as Box;
    for (const [other, otherBox] of unitBoxes) {
      if (other !== unit && overlaps(box, otherBox)) {
        warnings.push(`overlay: \`${unit}\` was moved onto \`${other}\``);
        break;
      }
    }
  }

  const extents: Box[] = [
    ...nodes,
    ...groups.values(),
    ...edges.flatMap((e) => (e.marker ? [e.marker.line, e.marker.tag] : e.label ? [e.label] : [])),
    ...edges.flatMap((e) => e.points.map(([x, y]) => ({ x, y, width: 0, height: 0 }))),
    ...(references ?? []).map((r) => r.border),
    ...notes.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height })),
  ];
  const out: LaidOutBoard = {
    ...laidOut,
    width: round(Math.max(laidOut.width, ...extents.map((b) => b.x + b.width + BOARD_PADDING))),
    height: round(Math.max(laidOut.height, ...extents.map((b) => b.y + b.height + BOARD_PADDING))),
    nodes,
    groups: laidOut.groups.map((g) => groups.get(g.id) as LaidOutGroup),
    edges,
  };
  if (references) out.references = references;
  return { laidOut: out, notes, warnings };
}
