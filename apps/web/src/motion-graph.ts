import { isReferenceElement, REFERENCE_PREFIX } from "./references.ts";

/**
 * The nodes and arrows of a rendered board, read back from the scene, for the motion drawn over
 * the canvas: arrows that run around the selection, and the presentation that reveals the board
 * one level of its graph at a time. Nothing here changes the scene.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MotionNode {
  /** The board node's id. */
  id: string;
  /** The id of the node's own element: `node/<id>`, or `node-<id>` in older scenes. */
  elementId: string;
  box: Box;
  /** Position of the node's element in the scene, which orders nodes of the same level. */
  order: number;
  /**
   * The node shown and hidden together with this one: the outermost node whose frame holds it
   * (a screen for its controls), or the node itself.
   */
  unit: string;
}

export interface MotionArrow {
  /** The board edge's id. */
  id: string;
  elementId: string;
  /** Board node ids from the arrow's bindings: the flow runs from `from` to `to`. */
  from: string;
  to: string;
  /** The arrow's points in scene coordinates, from its start to its end. */
  points: Array<[number, number]>;
  box: Box;
}

type Owner = { kind: "node"; id: string } | { kind: "edge"; id: string };

export interface MotionGraph {
  /** In scene order. */
  nodes: MotionNode[];
  /** In scene order. */
  arrows: MotionArrow[];
  nodeById: ReadonlyMap<string, MotionNode>;
  /** The node or edge each element of the scene is drawn for; absent for the rest of the board. */
  owners: ReadonlyMap<string, Owner>;
}

interface ElementLike {
  id?: unknown;
  type?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  points?: unknown;
  isDeleted?: boolean;
  frameId?: unknown;
  containerId?: unknown;
  startBinding?: { elementId?: unknown } | null;
  endBinding?: { elementId?: unknown } | null;
  customData?: unknown;
}

const dataOf = (el: ElementLike): Record<string, unknown> | null => {
  const data = (el.customData as { groundboard?: unknown } | null | undefined)?.groundboard;
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
};

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number => (typeof value === "number" ? value : 0);

/** Whether an element is the node's own element, in `/` or older `-` form. */
const isNodeElement = (id: string, nodeId: string) =>
  id === `node/${nodeId}` || id === `node-${nodeId}`;
const isEdgeElement = (id: string, edgeId: string) =>
  id === `edge/${edgeId}` || id === `edge-${edgeId}`;

function boundsOf(points: ReadonlyArray<readonly [number, number]>): Box {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * Reads the nodes and arrows of a scene. Notes a person drew over the board and arrows without
 * both bindings are left out, so such an arrow neither runs nor is hidden while presenting, and
 * a note stays in view throughout: it is the reader's own, anchored to no step. Reference
 * images are owned by their screen but are never nodes. `owners: false` skips working out who
 * each element is drawn for, which only the presentation needs. Deleted elements are left out unless `includeDeleted`, which the
 * presentation uses to read the whole board while layers the reader hid stay hidden.
 */
export function readMotionGraph(
  elements: readonly unknown[],
  options: { includeDeleted?: boolean; owners?: boolean } = {},
): MotionGraph {
  const live = (elements as ElementLike[]).filter(
    (el) =>
      typeof el === "object" &&
      el !== null &&
      typeof el.id === "string" &&
      (options.includeDeleted || el.isDeleted !== true) &&
      dataOf(el)?.overlay !== true &&
      !isReferenceElement(el),
  );

  const nodes: MotionNode[] = [];
  const nodeByElement = new Map<string, MotionNode>();
  live.forEach((el, order) => {
    const id = el.id as string;
    const nodeId = str(dataOf(el)?.nodeId);
    if (nodeId === null || !isNodeElement(id, nodeId)) return;
    const node: MotionNode = {
      id: nodeId,
      elementId: id,
      box: { x: num(el.x), y: num(el.y), width: num(el.width), height: num(el.height) },
      order,
      unit: nodeId,
    };
    nodes.push(node);
    nodeByElement.set(id, node);
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // A node inside another node's frame (a control on a screen) is shown with that node.
  const frameOf = new Map(live.map((el) => [el.id as string, str(el.frameId)]));
  for (const node of nodes) {
    let at = node;
    for (let depth = 0; depth < 16; depth++) {
      const frame = frameOf.get(at.elementId);
      const parent = frame === null || frame === undefined ? undefined : nodeByElement.get(frame);
      if (!parent || parent === node) break;
      at = parent;
    }
    node.unit = at.id;
  }

  const arrows: MotionArrow[] = [];
  for (const el of live) {
    const id = el.id as string;
    const edgeId = str(dataOf(el)?.edgeId);
    if (el.type !== "arrow" || edgeId === null || !isEdgeElement(id, edgeId)) continue;
    const from = nodeByElement.get(str(el.startBinding?.elementId) ?? "");
    const to = nodeByElement.get(str(el.endBinding?.elementId) ?? "");
    if (!from || !to || !Array.isArray(el.points) || el.points.length < 2) continue;
    const x0 = num(el.x);
    const y0 = num(el.y);
    const points = (el.points as unknown[][]).map((p): [number, number] => [
      x0 + num(p[0]),
      y0 + num(p[1]),
    ]);
    arrows.push({
      id: edgeId,
      elementId: id,
      from: from.id,
      to: to.id,
      points,
      box: boundsOf(points),
    });
  }
  const arrowById = new Map(arrows.map((a) => [a.id, a]));

  // Who each element is drawn for. A container's text follows the container, which may come
  // later in the scene, so text is settled after everything else.
  const owners = new Map<string, Owner>();
  if (options.owners === false) return { nodes, arrows, nodeById, owners };
  const direct = (el: ElementLike): Owner | null => {
    const id = el.id as string;
    const own = nodeByElement.get(id);
    if (own) return { kind: "node", id: own.id };
    const data = dataOf(el);
    const nodeId = str(data?.nodeId);
    if (nodeId !== null && nodeById.has(nodeId)) return { kind: "node", id: nodeId };
    const edgeId = str(data?.edgeId);
    if (edgeId !== null) {
      if (arrowById.has(edgeId)) return { kind: "edge", id: edgeId };
      // A marker for a screen on another board has no arrow: it goes with the control it
      // starts from.
      const from = str(data?.from);
      if (from !== null && nodeById.has(from)) return { kind: "node", id: from };
      return null;
    }
    const frame = nodeByElement.get(str(el.frameId) ?? "");
    return frame ? { kind: "node", id: frame.id } : null;
  };
  for (const el of live) {
    if (str(el.containerId) !== null) continue;
    const owner = direct(el);
    if (owner) owners.set(el.id as string, owner);
  }
  for (const el of live) {
    const container = str(el.containerId);
    if (container === null) continue;
    const owner = owners.get(container) ?? direct(el);
    if (owner) owners.set(el.id as string, owner);
  }

  // The reference image of a screen, and the marks drawn over it, go with that screen:
  // `refimg/<screen id>/…`. The legend row of reference images belongs to no screen.
  for (const el of elements as ElementLike[]) {
    if (typeof el?.id !== "string" || !el.id.startsWith(REFERENCE_PREFIX)) continue;
    if (!options.includeDeleted && el.isDeleted === true) continue;
    const screenId = el.id.slice(REFERENCE_PREFIX.length).split("/")[0] ?? "";
    if (nodeById.has(screenId)) owners.set(el.id, { kind: "node", id: screenId });
  }

  return { nodes, arrows, nodeById, owners };
}

/** The board nodes and edges among the selected elements, each once. */
export function selectedBoardItems(
  elements: readonly unknown[],
  selected: Readonly<Record<string, boolean>>,
): { nodes: string[]; edges: string[] } {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  for (const element of elements as ElementLike[]) {
    if (typeof element.id !== "string" || !selected[element.id]) continue;
    const data = dataOf(element);
    if (!data || data.overlay === true) continue;
    if (typeof data.nodeId === "string") nodes.add(data.nodeId);
    else if (typeof data.edgeId === "string") edges.add(data.edgeId);
  }
  return { nodes: [...nodes], edges: [...edges] };
}

/**
 * The arrows into and out of the selected nodes, and the selected arrows themselves, with the
 * nodes at both of their ends to light up.
 */
export function arrowsTouching(
  graph: MotionGraph,
  nodeIds: readonly string[],
  edgeIds: readonly string[],
): { arrows: MotionArrow[]; nodes: MotionNode[] } {
  const nodeSet = new Set(nodeIds);
  const edgeSet = new Set(edgeIds);
  const arrows = graph.arrows.filter(
    (a) => edgeSet.has(a.id) || nodeSet.has(a.from) || nodeSet.has(a.to),
  );
  const ends = new Set(arrows.flatMap((a) => [a.from, a.to]));
  return { arrows, nodes: graph.nodes.filter((n) => ends.has(n.id)) };
}

/** Whether a box overlaps another; used to draw only the arrows in view. */
export const intersects = (a: Box, b: Box) =>
  a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

export interface PresentationStep {
  /** Units (see `MotionNode.unit`) that appear at this step, in scene order. */
  nodes: string[];
  /** Edges that appear at this step: those into the new nodes first, then the rest. */
  arrows: string[];
}

/**
 * The steps of a presentation: breadth first from the nodes no arrow comes into, one level of
 * the graph per step, nodes of a level in scene order. When the levels run out while nodes on a
 * closed loop are still unseen, the first of them in scene order starts the next level. Each
 * edge appears once both its ends have, so back edges and self loops come with the later end.
 * Nodes with no arrow at all come last, together.
 */
export function presentationSteps(graph: MotionGraph): PresentationStep[] {
  const unitOf = (id: string) => graph.nodeById.get(id)?.unit ?? id;
  const units = graph.nodes.filter((n) => n.unit === n.id);
  const edges = graph.arrows.map((a) => ({ id: a.id, from: unitOf(a.from), to: unitOf(a.to) }));
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const entered = new Set(edges.filter((e) => e.from !== e.to).map((e) => e.to));

  const visited = new Set<string>();
  const assigned = new Set<string>();
  const steps: PresentationStep[] = [];
  const firstUnseen = () => units.filter((u) => linked.has(u.id) && !visited.has(u.id)).slice(0, 1);

  let level = units.filter((u) => linked.has(u.id) && !entered.has(u.id));
  if (level.length === 0) level = firstUnseen();
  while (level.length > 0) {
    const here = new Set(level.map((u) => u.id));
    for (const id of here) visited.add(id);
    const ready = edges.filter(
      (e) => !assigned.has(e.id) && visited.has(e.from) && visited.has(e.to),
    );
    const into = ready.filter((e) => here.has(e.to));
    const rest = ready.filter((e) => !here.has(e.to));
    for (const e of ready) assigned.add(e.id);
    steps.push({ nodes: [...here], arrows: [...into, ...rest].map((e) => e.id) });
    const next = new Set(
      edges.filter((e) => here.has(e.from) && !visited.has(e.to)).map((e) => e.to),
    );
    level = units.filter((u) => next.has(u.id));
    if (level.length === 0) level = firstUnseen();
  }

  const alone = units.filter((u) => !linked.has(u.id)).map((u) => u.id);
  if (alone.length > 0) steps.push({ nodes: alone, arrows: [] });
  return steps;
}

/**
 * The ids of the elements still hidden at step `index` of a presentation: the node and edge
 * elements of every later step, with their labels, marks and text. Elements drawn for no node or
 * edge (the title, frames of groups, the legend, reference images) always show.
 */
export function hiddenAtStep(
  graph: MotionGraph,
  steps: readonly PresentationStep[],
  index: number,
): Set<string> {
  const stepOfUnit = new Map<string, number>();
  const stepOfEdge = new Map<string, number>();
  steps.forEach((step, i) => {
    for (const id of step.nodes) stepOfUnit.set(id, i);
    for (const id of step.arrows) stepOfEdge.set(id, i);
  });
  const hidden = new Set<string>();
  for (const [elementId, owner] of graph.owners) {
    const step =
      owner.kind === "edge"
        ? stepOfEdge.get(owner.id)
        : stepOfUnit.get(graph.nodeById.get(owner.id)?.unit ?? owner.id);
    if (step !== undefined && step > index) hidden.add(elementId);
  }
  return hidden;
}

/**
 * The scene of a presentation step, derived from the scene as it was when the presentation
 * started: elements in `hidden` are marked deleted, everything else is the very element it was.
 * Elements already deleted then (a hidden layer, the Design button) are never touched, so the
 * starting scene itself is what leaving the presentation puts back.
 */
export function sceneAtStep<T>(start: readonly T[], hidden: ReadonlySet<string>): T[] {
  return start.map((element) => {
    const el = element as T & { id?: unknown; isDeleted?: boolean; version?: number };
    if (el.isDeleted === true || typeof el.id !== "string" || !hidden.has(el.id)) return element;
    return { ...el, isDeleted: true, version: (el.version ?? 1) + 1 };
  });
}

/** The node elements a step's camera frames: its new nodes and where its arrows start. */
export function stepFocus(graph: MotionGraph, step: PresentationStep | undefined): MotionNode[] {
  if (!step) return [];
  const unitOf = (id: string) => graph.nodeById.get(id)?.unit ?? id;
  const arrowById = new Map(graph.arrows.map((a) => [a.id, a]));
  const units = new Set(step.nodes);
  for (const id of step.arrows) {
    const arrow = arrowById.get(id);
    if (arrow) units.add(unitOf(arrow.from));
  }
  return graph.nodes.filter((n) => n.unit === n.id && units.has(n.id));
}
