import type { Board } from "@groundboard/schema";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import { COLUMN_PREFIX, INFO_PREFIX } from "./card.ts";
import { measureText } from "./measure.ts";
import { LOCAL_ROUTE_OFFSET } from "./ref-markers.ts";
import { FONT_SIZE, SMALL_FONT_SIZE } from "./text.ts";
import type { ElkInput, NodeMeasure } from "./to-elk.ts";
import { chipId, familyKey, ROOT_ID } from "./to-elk.ts";
import type {
  Direction,
  LaidOutBoard,
  LaidOutEdge,
  LaidOutGroup,
  LaidOutNode,
  LaidOutReference,
  LaidOutRefMarker,
  LaidOutText,
  Point,
} from "./types.ts";
import { FRAME_TITLE_HEIGHT, type ScreenLayout, type WireBox } from "./wireframe.ts";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Converts ELK's result to absolute coordinates. ELK positions children relative to their
 * parent, and an edge's sections and labels relative to the node that contains the edge.
 */
export function fromElk(
  result: ElkNode,
  board: Board,
  input: ElkInput,
  direction: Direction,
): LaidOutBoard {
  const absolute = new Map<string, { x: number; y: number }>();
  const elkNodes = new Map<string, ElkNode>();
  const edgeOwner = new Map<string, string>();

  const walk = (node: ElkNode, offsetX: number, offsetY: number) => {
    const x = node.id === ROOT_ID ? 0 : offsetX + (node.x ?? 0);
    const y = node.id === ROOT_ID ? 0 : offsetY + (node.y ?? 0);
    absolute.set(node.id, { x, y });
    elkNodes.set(node.id, node);
    for (const edge of node.edges ?? []) edgeOwner.set(edge.id, node.id);
    for (const child of node.children ?? []) walk(child, x, y);
  };
  walk(result, 0, 0);

  const groupById = new Map(board.groups.map((g) => [g.id, g]));
  const groups: LaidOutGroup[] = board.groups.map((group) => {
    const key = `g:${group.id}`;
    const elk = elkNodes.get(key) as ElkNode;
    const pos = absolute.get(key) as { x: number; y: number };
    let depth = 1;
    let parent = group.parentId;
    while (parent !== undefined) {
      depth += 1;
      parent = groupById.get(parent)?.parentId;
    }
    const out: LaidOutGroup = {
      id: group.id,
      label: group.label,
      depth,
      x: round(pos.x),
      y: round(pos.y),
      width: round(elk.width ?? 0),
      height: round(elk.height ?? 0),
    };
    if (group.parentId !== undefined) out.parentId = group.parentId;
    return out;
  });

  const placedBox = (id: string) => {
    const key = `n:${id}`;
    const elk = elkNodes.get(key) as ElkNode;
    const pos = absolute.get(key) as { x: number; y: number };
    return { x: pos.x, y: pos.y, width: elk.width ?? 0, height: elk.height ?? 0 };
  };

  const nodes: LaidOutNode[] = [];
  const byId = new Map<string, LaidOutNode>();
  const push = (node: LaidOutNode) => {
    nodes.push(node);
    byId.set(node.id, node);
  };
  // Screens first so each element can be offset by its frame.
  const frames = new Map<string, Box>();
  /** Top-left corner of each family's ELK node. */
  const familyOrigin = new Map<string, { x: number; y: number }>();
  for (const rootId of input.families.keys()) {
    familyOrigin.set(rootId, absolute.get(familyKey(rootId)) as { x: number; y: number });
  }
  const shift = (points: readonly Point[], origin: { x: number; y: number }): Point[] =>
    points.map(([x, y]) => [round(x + origin.x), round(y + origin.y)] as Point);
  for (const node of board.nodes) {
    if (!input.screens.has(node.id)) continue;
    const rootId = input.familyOf.get(node.id);
    if (rootId !== undefined) {
      const origin = familyOrigin.get(rootId) as { x: number; y: number };
      const frame = input.families.get(rootId)?.frames.get(node.id) as Box;
      frames.set(node.id, {
        x: round(origin.x + frame.x),
        y: round(origin.y + frame.y),
        width: frame.width,
        height: frame.height,
      });
      continue;
    }
    const placed = placedBox(node.id);
    const screen = input.screens.get(node.id) as ScreenLayout;
    frames.set(node.id, {
      x: placed.x,
      y: placed.y + FRAME_TITLE_HEIGHT,
      width: screen.width,
      height: screen.height,
    });
  }
  const wireBoxes = new Map<string, { box: WireBox; frame: Box }>();
  for (const [screenId, screen] of input.screens) {
    const frame = frames.get(screenId) as Box;
    for (const box of screen.boxes) wireBoxes.set(box.id, { box, frame });
  }

  for (const node of board.nodes) {
    if (input.screenOf.has(node.id)) {
      const wire = wireBoxes.get(node.id);
      const screenId = input.screenOf.get(node.id);
      if (!wire || screenId === undefined)
        throw new Error(`no wireframe box for element ${node.id}`);
      const { box, frame } = wire;
      const out: LaidOutNode = {
        id: node.id,
        kind: node.kind,
        shape: "wire",
        x: round(frame.x + box.x),
        y: round(frame.y + box.y),
        width: box.width,
        height: box.height,
        text: box.text,
        fontSize: box.fontSize,
        textWidth: box.textWidth,
        textHeight: box.textHeight,
        textX: round(frame.x + box.textX),
        textY: round(frame.y + box.textY),
        screenId,
      };
      if (node.parentId !== undefined) out.parentId = node.parentId;
      if (node.role !== undefined) out.role = node.role;
      if (node.ref !== undefined) out.ref = node.ref;
      push(out);
      continue;
    }
    const measure = input.measures.get(node.id);
    if (!measure) throw new Error(`no measurement for node ${node.id}`);
    if (input.screens.has(node.id)) {
      const frame = frames.get(node.id) as Box;
      const out: LaidOutNode = {
        id: node.id,
        kind: node.kind,
        shape: "frame",
        x: round(frame.x),
        y: round(frame.y),
        width: round(frame.width),
        height: round(frame.height),
        text: measure.text,
        fontSize: SMALL_FONT_SIZE,
        textWidth: measure.textWidth,
        textHeight: measure.textHeight,
      };
      if (node.ref !== undefined) out.ref = node.ref;
      push(out);
      continue;
    }
    const placed = placedBox(node.id);
    const out: LaidOutNode = {
      id: node.id,
      kind: node.kind,
      shape: measure.shape,
      x: round(placed.x),
      y: round(placed.y),
      width: round(placed.width),
      height: round(placed.height),
      text: measure.text,
      fontSize: FONT_SIZE,
      textWidth: measure.textWidth,
      textHeight: measure.textHeight,
    };
    if (node.groupId !== undefined) out.groupId = node.groupId;
    if (node.ref !== undefined) out.ref = node.ref;
    push(out);
  }
  // The columns of a table and the rows of a job are rows of a card but no board node: each
  // becomes a node of its own kind, placed in the card's frame, so the renderer can find it.
  for (const [rowId, { box, frame }] of wireBoxes) {
    const column = rowId.startsWith(COLUMN_PREFIX);
    if (!column && !rowId.startsWith(INFO_PREFIX)) continue;
    push({
      id: rowId,
      kind: column ? "column" : "row",
      shape: "wire",
      x: round(frame.x + box.x),
      y: round(frame.y + box.y),
      width: box.width,
      height: box.height,
      text: box.text,
      fontSize: box.fontSize,
      textWidth: box.textWidth,
      textHeight: box.textHeight,
      textX: round(frame.x + box.textX),
      textY: round(frame.y + box.textY),
      screenId: input.screenOf.get(rowId) as string,
    });
  }
  for (const [id, ref] of input.chips) {
    const measure = input.measures.get(id) as NodeMeasure;
    const placed = placedBox(id);
    push({
      id,
      kind: "ref",
      shape: "chip",
      ref,
      x: round(placed.x),
      y: round(placed.y),
      width: round(placed.width),
      height: round(placed.height),
      text: measure.text,
      fontSize: SMALL_FONT_SIZE,
      textWidth: measure.textWidth,
      textHeight: measure.textHeight,
    });
  }

  const elkEdges = new Map<string, ElkExtendedEdge>();
  const collect = (node: ElkNode) => {
    for (const edge of node.edges ?? []) elkEdges.set(edge.id, edge);
    for (const child of node.children ?? []) collect(child);
  };
  collect(result);

  /** Each marker edge's tag and list line, moved from its frame's body onto the board. */
  const markerOf = new Map<string, LaidOutRefMarker>();
  for (const [screenId, list] of input.markers) {
    const frame = frames.get(screenId) as Box;
    const place = (t: LaidOutText): LaidOutText => ({
      ...t,
      x: round(frame.x + t.x),
      y: round(frame.y + t.y),
    });
    for (const marker of list.markers) {
      markerOf.set(marker.edgeId, {
        number: marker.number,
        screenId,
        tag: place(marker.tag),
        line: place(marker.line),
      });
    }
  }

  const edges: LaidOutEdge[] = board.edges.map((edge) => {
    const to = edge.toRef !== undefined ? chipId(edge.toRef) : (edge.to as string);
    const out: LaidOutEdge = { id: edge.id, from: edge.from, to, kind: edge.kind, points: [] };
    if (edge.toRef !== undefined) out.toRef = edge.toRef;
    const marker = markerOf.get(edge.id);
    if (marker !== undefined) {
      out.marker = marker;
      return out;
    }
    const text = input.edgeLabels.get(edge.id);

    if (input.localEdges.has(edge.id)) {
      const screenId = input.screenOf.get(edge.from) ?? (edge.from as string);
      const frame = frames.get(screenId) as Box;
      out.points = localRoute(
        byId.get(edge.from) as LaidOutNode,
        byId.get(to) as LaidOutNode,
        frame,
      );
      if (text !== undefined) {
        const size = measureText(text, SMALL_FONT_SIZE);
        const [, a, b] = out.points as [Point, Point, Point, Point];
        out.label = {
          text,
          fontSize: SMALL_FONT_SIZE,
          x: round(a[0] + 4),
          y: round((a[1] + b[1]) / 2 - size.height / 2),
          width: size.width,
          height: size.height,
        };
      }
      return out;
    }

    const familyRoot = input.familyOf.get(input.screenOf.get(edge.from) ?? edge.from);
    if (input.familyEdges.has(edge.id) && familyRoot !== undefined) {
      const route = input.families.get(familyRoot)?.edges.get(edge.id);
      const origin = familyOrigin.get(familyRoot) as { x: number; y: number };
      if (!route) throw new Error(`no family route for edge ${edge.id}`);
      out.points = shift(route.points, origin);
      if (route.label) {
        out.label = {
          ...route.label,
          x: round(route.label.x + origin.x),
          y: round(route.label.y + origin.y),
        };
      }
      return out;
    }

    const key = `e:${edge.id}`;
    const elk = elkEdges.get(key);
    if (!elk) throw new Error(`ELK returned no route for edge ${edge.id}`);
    const owner = (elk as { container?: string }).container ?? edgeOwner.get(key) ?? ROOT_ID;
    const offset = absolute.get(owner) ?? { x: 0, y: 0 };
    const section = elk.sections?.[0];
    if (!section) throw new Error(`ELK returned no route for edge ${edge.id}`);
    const raw = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    let points: Point[] = raw.map((p) => [round(p.x + offset.x), round(p.y + offset.y)]);
    // An end inside a family leaves or enters it through a port; the family routes the rest.
    const portRoute = (nodeId: string) => {
      const rootId = input.familyOf.get(input.screenOf.get(nodeId) ?? nodeId);
      const port =
        rootId === undefined ? undefined : input.families.get(rootId)?.ports.get(edge.id);
      return port === undefined || rootId === undefined
        ? undefined
        : shift(port.points, familyOrigin.get(rootId) as { x: number; y: number });
    };
    const outRoute = portRoute(edge.from);
    const inRoute = edge.toRef === undefined ? portRoute(to) : undefined;
    points =
      outRoute === undefined
        ? attachEnd(points, edge.from, "start")
        : [...outRoute.slice(0, -1), ...joinPort(outRoute.at(-1) as Point, points, "start")];
    points =
      inRoute === undefined
        ? attachEnd(points, to, "end")
        : [...joinPort(inRoute[0] as Point, points, "end"), ...inRoute.slice(1)];
    out.points = dedupe(points);
    const label = elk.labels?.[0];
    if (text !== undefined && label) {
      out.label = {
        text,
        fontSize: SMALL_FONT_SIZE,
        x: round((label.x ?? 0) + offset.x),
        y: round((label.y ?? 0) + offset.y),
        width: round(label.width ?? 0),
        height: round(label.height ?? 0),
      };
    }
    return out;
  });

  /**
   * ELK routes an edge to the box it placed: for an element, its screen's box (title band
   * included). An element end gets an orthogonal stub from the element out to that border; a
   * screen end that ELK put in the title band is moved onto the frame.
   */
  function attachEnd(points: Point[], nodeId: string, which: "start" | "end"): Point[] {
    const ordered = which === "start" ? points : [...points].reverse();
    const fixed = attachStart(ordered, nodeId);
    return which === "start" ? fixed : fixed.reverse();
  }

  function attachStart(points: Point[], nodeId: string): Point[] {
    const first = points[0] as Point;
    const element = input.screenOf.get(nodeId);
    if (element !== undefined) {
      const node = byId.get(nodeId) as LaidOutNode;
      const placed = placedBox(element);
      const [px, py] = first;
      const midX = round(node.x + node.width / 2);
      const midY = round(node.y + node.height / 2);
      switch (sideOf(first, placed)) {
        case "right":
          return [[round(node.x + node.width), midY], [px, midY], ...points];
        case "left":
          return [[node.x, midY], [px, midY], ...points];
        case "top":
          return [[midX, node.y], [midX, py], ...points];
        default:
          return [[midX, round(node.y + node.height)], [midX, py], ...points];
      }
    }
    const frame = frames.get(nodeId);
    if (frame === undefined || first[1] >= frame.y) return points;
    const side = sideOf(first, placedBox(nodeId));
    if (side === "top") return [[first[0], frame.y], ...points.slice(1)];
    const next = points[1] as Point;
    // A side end in the title band: slide the horizontal segment down onto the frame.
    if ((side === "left" || side === "right") && points.length >= 3 && next[1] === first[1]) {
      const y = round(frame.y + 8);
      return [[first[0], y], [next[0], y], ...points.slice(2)];
    }
    return points;
  }

  const references: LaidOutReference[] = [];
  for (const [screenId, reference] of input.references) {
    const frame = frames.get(screenId) as Box;
    const place = <T extends Box>(b: T): T => ({
      ...b,
      x: round(frame.x + b.x),
      y: round(frame.y + b.y),
    });
    references.push({
      screenId,
      image: place(reference.image),
      border: place(reference.border),
      caption: place(reference.caption),
    });
  }

  // A list or a reference in a frame's margin may reach past the bounds ELK gives the graph.
  const BOARD_PADDING = 20;
  const extents: Box[] = [
    ...[...markerOf.values()].map((m) => m.line),
    ...references.map((r) => r.border),
  ];
  return {
    direction,
    width: round(Math.max(result.width ?? 0, ...extents.map((l) => l.x + l.width + BOARD_PADDING))),
    height: round(
      Math.max(result.height ?? 0, ...extents.map((l) => l.y + l.height + BOARD_PADDING)),
    ),
    nodes,
    groups,
    edges,
    ...(references.length > 0 ? { references } : {}),
  };
}

/**
 * Joins the family's route at its port with ELK's route, which starts (or ends) at the same
 * port; ELK may round the port's position, so a short orthogonal step closes any gap.
 */
function joinPort(port: Point, points: Point[], which: "start" | "end"): Point[] {
  const ordered = which === "start" ? points : [...points].reverse();
  const first = ordered[0] as Point;
  const joined: Point[] =
    first[0] === port[0] && first[1] === port[1]
      ? ordered
      : [port, [first[0], port[1]], ...ordered];
  return which === "start" ? joined : joined.reverse();
}

function sideOf([px, py]: Point, box: Box): "left" | "right" | "top" | "bottom" {
  const distances = [
    ["left", Math.abs(px - box.x)],
    ["right", Math.abs(px - (box.x + box.width))],
    ["top", Math.abs(py - box.y)],
    ["bottom", Math.abs(py - (box.y + box.height))],
  ] as const;
  let best: (typeof distances)[number] = distances[0];
  for (const entry of distances) if (entry[1] < best[1]) best = entry;
  return best[0];
}

/** Drops consecutive repeated points; a route keeps at least two points. */
function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  if (out.length === 1) out.push(out[0] as Point);
  return out;
}

/**
 * Route for an edge inside one screen: out of the right side of the source, along the outside
 * of the frame's right edge, and into the right side of the target. A screen end uses a point
 * near the top of the frame's right edge.
 */
function localRoute(from: LaidOutNode, to: LaidOutNode, frame: Box): Point[] {
  const outX = round(frame.x + frame.width + LOCAL_ROUTE_OFFSET);
  const anchor = (node: LaidOutNode): Point =>
    node.shape === "frame"
      ? [round(frame.x + frame.width), round(frame.y + LOCAL_ROUTE_OFFSET)]
      : [round(node.x + node.width), round(node.y + node.height / 2)];
  const start = anchor(from);
  const end = anchor(to);
  return [start, [outX, start[1]], [outX, end[1]], end];
}
