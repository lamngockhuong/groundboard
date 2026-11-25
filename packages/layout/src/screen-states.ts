import type { Board, BoardEdge } from "@groundboard/schema";
import { measureText } from "./measure.ts";
import type { FrameMarkers } from "./ref-markers.ts";
import { edgeLabelText, SMALL_FONT_SIZE } from "./text.ts";
import type { LaidOutEdgeLabel, Point } from "./types.ts";
import { FRAME_TITLE_HEIGHT, type ScreenLayout } from "./wireframe.ts";

/**
 * A screen with states is laid out here rather than by ELK: its frames in a grid (the main path
 * on the first row, branches on a second), and every transition between two of its frames on
 * a route of its own. ELK then places the whole family as one fixed-size node.
 *
 * Routes are orthogonal. A transition leaves its source on the right, runs down or up an exit
 * lane in the gap right of the source column, along a corridor track above the first row (or
 * between the rows when either end is on the second), and down or up an entry lane in the gap
 * left of the target column into a slot on the target's left edge. Between adjacent columns
 * the exit and entry lane are one lane. Every lane, track and slot is used by one edge only,
 * so no two arrows share a segment and no two labels share a band.
 */

/** Gap between a frame and the first lane next to it, and between the last lane and the next frame. */
const GAP_MARGIN = 24;
const LANE_SPACING = 14;
/** Narrowest gap between two columns. */
const MIN_GAP = 96;
/** Distance between corridor tracks beyond the label's height. */
const TRACK_PAD = 12;
/** Distance between entry slots on a frame edge, room for one arrowhead. */
const SLOT_SPACING = 24;
/** Distance between exit slots on a frame edge, and between stubs that leave below a frame. */
const EXIT_SPACING = 12;
const SLOT_TOP = 20;
const LABEL_OFFSET = 6;
/** Room around the family for edges that leave or enter it. */
const OUTER_PAD = 20;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FamilyEdgeRoute {
  points: Point[];
  label?: LaidOutEdgeLabel;
}

export interface FamilyPort {
  edgeId: string;
  /** East for an edge that leaves the family, west for one that enters it. */
  side: "east" | "west";
  x: number;
  y: number;
  /** The route inside the family: element to port when leaving, port to element when entering. */
  points: Point[];
}

export interface FamilyLayout {
  rootId: string;
  /** Root first, then the states in board order. */
  members: string[];
  width: number;
  height: number;
  /** Frame bodies (below the title band), relative to the family's top-left corner. */
  frames: Map<string, Box>;
  /** Routes of edges between two frames of the family, relative to the family. */
  edges: Map<string, FamilyEdgeRoute>;
  /** One port per edge that crosses the family boundary. */
  ports: Map<string, FamilyPort>;
}

interface Placement {
  row: 0 | 1;
  col: number;
}

type Corridor = "top" | "middle";

interface InternalPlan {
  edge: BoardEdge;
  kind: "internal";
  from: string;
  to: string;
  fromFrame: string;
  toFrame: string;
  direct: boolean;
  corridor: Corridor;
  label?: { text: string; width: number; height: number };
}

interface CrossPlan {
  edge: BoardEdge;
  kind: "out" | "in";
  /** The family end: an element or frame of the family. */
  end: string;
  frame: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Orders the frames of one family: the main row follows, from the root, the first transition
 * (in board order) out of the current frame to a frame not yet placed; every other state goes
 * on the second row, one column right of the frame that first reaches it, in board order.
 */
export function placeFamily(
  members: readonly string[],
  internal: ReadonlyArray<{ fromFrame: string; toFrame: string }>,
): Map<string, Placement> {
  const placement = new Map<string, Placement>();
  const root = members[0] as string;
  placement.set(root, { row: 0, col: 0 });
  let current = root;
  let col = 0;
  for (;;) {
    const next = internal.find((e) => e.fromFrame === current && !placement.has(e.toFrame));
    if (next === undefined) break;
    col += 1;
    placement.set(next.toFrame, { row: 0, col });
    current = next.toFrame;
  }
  let nextFree = 0;
  const rest = members.filter((m) => !placement.has(m));
  // A branch may be reached from another branch; place in rounds until nothing changes.
  let pending = rest;
  while (pending.length > 0) {
    const left: string[] = [];
    for (const member of pending) {
      const from = internal.find((e) => e.toFrame === member && placement.has(e.fromFrame));
      if (from === undefined) {
        left.push(member);
        continue;
      }
      const at = Math.max((placement.get(from.fromFrame) as Placement).col + 1, nextFree);
      placement.set(member, { row: 1, col: at });
      nextFree = at + 1;
    }
    if (left.length === pending.length) {
      for (const member of left) {
        placement.set(member, { row: 1, col: nextFree });
        nextFree += 1;
      }
      break;
    }
    pending = left;
  }
  return placement;
}

/**
 * Lays out one family. `frameOf` maps every element and screen of the board to the screen whose
 * frame holds it; `screens` holds each frame's wireframe; `markers` the tags and list of targets
 * of the frames with `toRef` edges drawn as markers. Those edges never leave the family, so they
 * get no port; each frame's column and row leave room for its list.
 */
export function layoutFamily(
  board: Board,
  rootId: string,
  states: readonly string[],
  screens: ReadonlyMap<string, ScreenLayout>,
  frameOf: ReadonlyMap<string, string>,
  markers: ReadonlyMap<string, FrameMarkers> = new Map(),
): FamilyLayout {
  const members = [rootId, ...states];
  const markerEdges = new Set(
    [...markers.values()].flatMap((frame) => frame.markers.map((m) => m.edgeId)),
  );
  const inFamily = new Set(members);
  const frameIn = (nodeId: string | undefined) => {
    if (nodeId === undefined) return undefined;
    const frame = frameOf.get(nodeId);
    return frame !== undefined && inFamily.has(frame) ? frame : undefined;
  };

  const internal: InternalPlan[] = [];
  const cross: CrossPlan[] = [];
  for (const edge of board.edges) {
    if (markerEdges.has(edge.id)) continue;
    const fromFrame = frameIn(edge.from);
    const toFrame = edge.toRef === undefined ? frameIn(edge.to) : undefined;
    if (fromFrame !== undefined && toFrame !== undefined) {
      if (fromFrame === toFrame) continue; // drawn by the wireframe's local route
      const text = edge.label ? edgeLabelText(edge.label) : undefined;
      const plan: InternalPlan = {
        edge,
        kind: "internal",
        from: edge.from,
        to: edge.to as string,
        fromFrame,
        toFrame,
        direct: false,
        corridor: "top",
      };
      if (text !== undefined) plan.label = { text, ...measureText(text, SMALL_FONT_SIZE) };
      internal.push(plan);
    } else if (fromFrame !== undefined) {
      cross.push({ edge, kind: "out", end: edge.from, frame: fromFrame });
    } else if (toFrame !== undefined) {
      cross.push({ edge, kind: "in", end: edge.to as string, frame: toFrame });
    }
  }

  const placement = placeFamily(members, internal);
  const at = (frame: string) => placement.get(frame) as Placement;
  for (const plan of internal) {
    const a = at(plan.fromFrame);
    const b = at(plan.toFrame);
    plan.direct = b.col === a.col + 1;
    plan.corridor = a.row === 0 && b.row === 0 ? "top" : "middle";
  }
  const columns = Math.max(...[...placement.values()].map((p) => p.col)) + 1;

  // Lanes per gap; gap g lies left of column g, gap `columns` is the right margin.
  type Lane = { key: string; order: number };
  const lanes: Lane[][] = Array.from({ length: columns + 1 }, () => []);
  const labelRoom = new Array<number>(columns + 1).fill(0);
  const exitLane = new Map<string, number>();
  const entryLane = new Map<string, number>();
  // Exit lanes nearest the left frame, then entry lanes, then direct lanes nearest the target,
  // so a direct edge's label, on its last segment, crosses no other edge's lane.
  for (const plan of internal) {
    const exitGap = at(plan.fromFrame).col + 1;
    const entryGap = at(plan.toFrame).col;
    if (plan.direct) {
      lanes[entryGap]?.push({ key: `d:${plan.edge.id}`, order: 2 });
      labelRoom[entryGap] = Math.max(
        labelRoom[entryGap] as number,
        (plan.label?.width ?? 0) + 2 * LABEL_OFFSET,
      );
    } else {
      lanes[exitGap]?.push({ key: `x:${plan.edge.id}`, order: 0 });
      lanes[entryGap]?.push({ key: `n:${plan.edge.id}`, order: 1 });
    }
  }
  for (const plan of cross) {
    const col = at(plan.frame).col;
    if (plan.kind === "out") lanes[col + 1]?.push({ key: `x:${plan.edge.id}`, order: 0 });
    else lanes[col]?.push({ key: `n:${plan.edge.id}`, order: 1 });
  }
  for (const gap of lanes) gap.sort((p, q) => p.order - q.order);

  const gapWidth = lanes.map((gap, g) => {
    const needed =
      2 * GAP_MARGIN + Math.max(0, gap.length - 1) * LANE_SPACING + (labelRoom[g] ?? 0);
    return g === 0 || g === columns ? Math.max(OUTER_PAD, needed) : Math.max(MIN_GAP, needed);
  });
  const colWidth = new Array<number>(columns).fill(0);
  for (const [frame, p] of placement) {
    colWidth[p.col] = Math.max(
      colWidth[p.col] as number,
      (screens.get(frame) as ScreenLayout).width + (markers.get(frame)?.width ?? 0),
    );
  }
  const colX: number[] = [];
  let cursor = 0;
  for (let c = 0; c < columns; c++) {
    cursor += gapWidth[c] as number;
    colX.push(cursor);
    cursor += colWidth[c] as number;
  }
  const width = cursor + (gapWidth[columns] as number);
  /** Left edge of gap g. */
  const gapLeft = (g: number) =>
    g === 0 ? 0 : (colX[g - 1] as number) + (colWidth[g - 1] as number);
  const laneX = new Map<string, number>();
  lanes.forEach((gap, g) => {
    // Lanes hug the left of the gap; the label room of direct edges sits on the right.
    gap.forEach((lane, i) => {
      laneX.set(lane.key, round(gapLeft(g) + GAP_MARGIN + i * LANE_SPACING));
    });
  });
  for (const plan of internal) {
    if (plan.direct) continue;
    exitLane.set(plan.edge.id, laneX.get(`x:${plan.edge.id}`) as number);
    entryLane.set(plan.edge.id, laneX.get(`n:${plan.edge.id}`) as number);
  }

  // Corridor tracks: the top corridor holds row-to-row edges of the first row and every edge
  // that crosses the family boundary; the middle one, edges that touch the second row.
  const labelHeight = measureText("Ag", SMALL_FONT_SIZE).height;
  const top: Array<{ id: string; height: number }> = [];
  const middle: Array<{ id: string; height: number }> = [];
  for (const plan of internal) {
    if (plan.direct) continue;
    (plan.corridor === "top" ? top : middle).push({
      id: plan.edge.id,
      height: (plan.label?.height ?? labelHeight) + TRACK_PAD,
    });
  }
  for (const plan of cross) top.push({ id: plan.edge.id, height: labelHeight + TRACK_PAD });
  const topHeight = top.reduce((sum, t) => sum + t.height, 0) + OUTER_PAD;
  const row0Top = topHeight + FRAME_TITLE_HEIGHT;
  const rowHeight = (row: 0 | 1) =>
    Math.max(
      0,
      ...[...placement]
        .filter(([, p]) => p.row === row)
        .map(([frame]) =>
          Math.max((screens.get(frame) as ScreenLayout).height, markers.get(frame)?.bottom ?? 0),
        ),
    );
  const row0Bottom = row0Top + rowHeight(0);
  const middleHeight = middle.reduce((sum, t) => sum + t.height, 0) + 2 * GAP_MARGIN;
  const hasRow1 = [...placement.values()].some((p) => p.row === 1);
  const row1Top = row0Bottom + middleHeight + FRAME_TITLE_HEIGHT;
  const height = round((hasRow1 ? row1Top + rowHeight(1) : row0Bottom) + OUTER_PAD);

  // Track y: the line sits at the bottom of its band, its label just above it. Top tracks are
  // stacked upwards from the first row's titles; middle tracks downwards from the first row.
  const trackY = new Map<string, number>();
  let y = topHeight - OUTER_PAD / 2;
  for (const track of top) {
    trackY.set(track.id, round(y));
    y -= track.height;
  }
  y = row0Bottom + GAP_MARGIN;
  for (const track of middle) {
    y += track.height;
    trackY.set(track.id, round(y));
  }

  const frames = new Map<string, Box>();
  for (const [frame, p] of placement) {
    const screen = screens.get(frame) as ScreenLayout;
    frames.set(frame, {
      x: colX[p.col] as number,
      y: p.row === 0 ? row0Top : row1Top,
      width: screen.width,
      height: screen.height,
    });
  }

  // Slots on frame edges, handed out in edge order. A frame too short for all of its slots
  // squeezes them evenly between its top and bottom.
  const entryRoom = new Map<string, number>();
  const exitRoom = new Map<string, number>();
  const addRoom = (rooms: Map<string, number>, frame: string, room: number) =>
    rooms.set(frame, (rooms.get(frame) ?? 0) + room);
  const entryRoomOf = (plan: InternalPlan) =>
    plan.direct && plan.label ? plan.label.height + 2 * LABEL_OFFSET : SLOT_SPACING;
  for (const plan of internal) {
    if (plan.to === plan.toFrame) addRoom(entryRoom, plan.toFrame, entryRoomOf(plan));
    if (plan.from === plan.fromFrame) addRoom(exitRoom, plan.fromFrame, EXIT_SPACING);
  }
  for (const plan of cross) {
    if (plan.end !== plan.frame) continue;
    addRoom(
      plan.kind === "in" ? entryRoom : exitRoom,
      plan.frame,
      plan.kind === "in" ? SLOT_SPACING : EXIT_SPACING,
    );
  }
  const used = new Map<string, number>();
  const slot = (rooms: Map<string, number>, key: string, frame: string, room: number): number => {
    const f = frames.get(frame) as Box;
    const total = rooms.get(frame) ?? room;
    const scale = Math.min(1, Math.max(0, f.height - 2 * (SLOT_TOP / 2)) / total);
    const at = used.get(key) ?? 0;
    used.set(key, at + room);
    const offset = scale < 1 ? SLOT_TOP / 2 + (at + room / 2) * scale : SLOT_TOP + at;
    return round(f.y + offset);
  };

  const parentOf = new Map(board.nodes.map((n) => [n.id, n.parentId]));
  const ancestorsOf = (nodeId: string) => {
    const out = new Set<string>();
    let current = parentOf.get(nodeId);
    while (current !== undefined && !out.has(current)) {
      out.add(current);
      current = parentOf.get(current);
    }
    return out;
  };
  const elementBox = (nodeId: string, frame: string): Box | undefined => {
    const box = (screens.get(frame) as ScreenLayout).boxes.find((b) => b.id === nodeId);
    const f = frames.get(frame) as Box;
    return box === undefined
      ? undefined
      : { x: f.x + box.x, y: f.y + box.y, width: box.width, height: box.height };
  };
  /** Other elements of the frame that are not the element's containers. */
  const othersOf = (nodeId: string, frame: string): Box[] => {
    const skip = ancestorsOf(nodeId);
    skip.add(nodeId);
    return (screens.get(frame) as ScreenLayout).boxes
      .filter((b) => !skip.has(b.id))
      .map((b) => elementBox(b.id, frame) as Box);
  };
  const belowCount = new Map<string, number>();
  const elementExits = new Map<string, number>();
  /**
   * The start of an edge at its family end, up to the point where it turns into its lane: an
   * element's right side, or below the frame when another element sits to its right (a row of
   * buttons), or a slot on the frame's right edge.
   */
  const startOf = (nodeId: string, frame: string): Point[] => {
    const f = frames.get(frame) as Box;
    const box = nodeId === frame ? undefined : elementBox(nodeId, frame);
    if (box === undefined) {
      return [[round(f.x + f.width), slot(exitRoom, `x:${frame}`, frame, EXIT_SPACING)]];
    }
    const k = elementExits.get(nodeId) ?? 0;
    elementExits.set(nodeId, k + 1);
    const midY = box.y + box.height / 2 + k * 6;
    const others = othersOf(nodeId, frame);
    const right = box.x + box.width;
    const blockedRight = others.some(
      (o) => o.x >= right - 1 && o.y <= midY && o.y + o.height >= midY,
    );
    const midX = box.x + box.width / 2 + k * 6;
    const bottom = box.y + box.height;
    const blockedBelow = others.some(
      (o) => o.y >= bottom - 1 && o.x <= midX && o.x + o.width >= midX,
    );
    if (!blockedRight || blockedBelow) return [[round(right), round(midY)]];
    const n = belowCount.get(frame) ?? 0;
    belowCount.set(frame, n + 1);
    const below = round(f.y + f.height + EXIT_SPACING * (n + 1));
    return [
      [round(midX), round(bottom)],
      [round(midX), below],
    ];
  };
  /** Where an edge enters its family end: a slot on the frame's left edge, or an element's left side. */
  const endOf = (nodeId: string, frame: string, room: number): Point => {
    const box = nodeId === frame ? undefined : elementBox(nodeId, frame);
    if (box === undefined) {
      return [(frames.get(frame) as Box).x, slot(entryRoom, `n:${frame}`, frame, room)];
    }
    return [round(box.x), round(box.y + box.height / 2)];
  };
  const labelAt = (
    text: { text: string; width: number; height: number },
    [cx, cy]: Point,
  ): LaidOutEdgeLabel => ({
    text: text.text,
    fontSize: SMALL_FONT_SIZE,
    x: round(cx - text.width / 2),
    y: round(cy - text.height / 2),
    width: text.width,
    height: text.height,
  });

  const edges = new Map<string, FamilyEdgeRoute>();
  for (const plan of internal) {
    const head = startOf(plan.from, plan.fromFrame);
    const [, startY] = head.at(-1) as Point;
    const end = endOf(plan.to, plan.toFrame, entryRoomOf(plan));
    let points: Point[];
    /** Index of the segment the label sits on. */
    let labelSegment: number;
    if (plan.direct) {
      const lane = laneX.get(`d:${plan.edge.id}`) as number;
      points = [...head, [lane, startY], [lane, end[1]]];
      if (plan.label) {
        // The label sits on the last segment, just right of the lane.
        const split = round(lane + plan.label.width + 2 * LABEL_OFFSET);
        if (split < end[0]) points.push([split, end[1]]);
      }
      points.push(end);
      labelSegment = plan.label ? head.length + 1 : head.length;
    } else {
      const exit = exitLane.get(plan.edge.id) as number;
      const entry = entryLane.get(plan.edge.id) as number;
      const track = trackY.get(plan.edge.id) as number;
      points = [...head, [exit, startY], [exit, track], [entry, track], [entry, end[1]], end];
      labelSegment = head.length + 1;
    }
    const centred = centreSegment(points, labelSegment);
    const route: FamilyEdgeRoute = { points: centred };
    if (plan.label) route.label = labelAt(plan.label, segmentCentre(centred));
    edges.set(plan.edge.id, route);
  }

  const ports = new Map<string, FamilyPort>();
  for (const plan of cross) {
    const track = trackY.get(plan.edge.id) as number;
    if (plan.kind === "out") {
      const head = startOf(plan.end, plan.frame);
      const [, startY] = head.at(-1) as Point;
      const exit = laneX.get(`x:${plan.edge.id}`) as number;
      ports.set(plan.edge.id, {
        edgeId: plan.edge.id,
        side: "east",
        x: round(width),
        y: track,
        points: dedupe([...head, [exit, startY], [exit, track], [round(width), track]]),
      });
    } else {
      const end = endOf(plan.end, plan.frame, SLOT_SPACING);
      const entry = laneX.get(`n:${plan.edge.id}`) as number;
      ports.set(plan.edge.id, {
        edgeId: plan.edge.id,
        side: "west",
        x: 0,
        y: track,
        points: dedupe([[0, track], [entry, track], [entry, end[1]], end]),
      });
    }
  }

  return { rootId, members, width: round(width), height, frames, edges, ports };
}

/**
 * Excalidraw centres an arrow's label on its middle segment (an even number of points) or its
 * middle point. Splits segments on the shorter side at their midpoints, without moving the
 * route, until segment `index` is the middle one.
 */
export function centreSegment(points: readonly Point[], index: number): Point[] {
  const out = dedupeKeep(points, index);
  let target = out.index;
  const route = out.points;
  for (let guard = 0; guard < 64; guard++) {
    const before = target;
    const after = route.length - 2 - target;
    if (before === after) break;
    const short = before < after ? "before" : "after";
    if ((short === "before" ? before : after) === 0) {
      // Nothing on the short side to split: cut the target into three, keeping the middle
      // piece centred where the target was, so the outer piece can be split next.
      const a = route[target] as Point;
      const b = route[target + 1] as Point;
      const q: Point = [round(a[0] + (b[0] - a[0]) / 4), round(a[1] + (b[1] - a[1]) / 4)];
      const r: Point = [
        round(a[0] + (3 * (b[0] - a[0])) / 4),
        round(a[1] + (3 * (b[1] - a[1])) / 4),
      ];
      route.splice(target + 1, 0, q, r);
      target += 1;
      continue;
    }
    // Split the segment at the far end of the short side.
    const at = short === "before" ? 0 : route.length - 2;
    const a = route[at] as Point;
    const b = route[at + 1] as Point;
    route.splice(at + 1, 0, [round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)]);
    if (short === "before") target += 1;
  }
  return route;
}

/** The centre of the middle segment, where Excalidraw puts the label. */
export function segmentCentre(points: readonly Point[]): Point {
  const n = points.length;
  if (n % 2 === 1) return points[(n - 1) / 2] as Point;
  const a = points[n / 2 - 1] as Point;
  const b = points[n / 2] as Point;
  return [round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)];
}

/** Drops repeated points and says where segment `index` ended up. */
function dedupeKeep(points: readonly Point[], index: number): { points: Point[]; index: number } {
  const out: Point[] = [];
  let mapped = 0;
  points.forEach((p, i) => {
    const last = out.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
    if (i === index) mapped = out.length - 1;
  });
  return { points: out, index: Math.min(mapped, Math.max(0, out.length - 2)) };
}

function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}
