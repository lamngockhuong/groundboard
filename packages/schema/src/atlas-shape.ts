import type { Board, BoardEdge, BoardNode, ElementRole, HandlerShape, NodeKind } from "./board.ts";
import { FLOW_EDGE_KINDS } from "./edges.ts";
import { parseRef, type RefNamespace, rootRefOf } from "./ref.ts";
import { familyOf, stateRoots } from "./states.ts";
import { columnRefs } from "./table.ts";

/**
 * How boards fit together in an atlas: what kind of board each one is, which nodes define a ref
 * and which point at one, and when a ref is defined twice. The server's atlas index and the
 * viewer's own index of opened boards both read these, so they never disagree.
 */

/** The kinds of atlas boards, as the sidebar groups them. */
export const ATLAS_BOARD_KINDS = ["overview", "screen", "flow", "api", "db", "batch"] as const;
export type AtlasBoardKind = (typeof ATLAS_BOARD_KINDS)[number];

/** For each namespace, the node kinds that define its first-level and second-level refs. */
export interface RefDefiner {
  root: readonly NodeKind[];
  child: readonly NodeKind[];
  /** Refs a node defines besides its own, such as the columns of a table. */
  deriveChildren?: (node: BoardNode) => string[];
}

export const REF_DEFINERS: Record<RefNamespace, RefDefiner> = {
  web: { root: ["screen"], child: ["element"] },
  mobile: { root: ["screen"], child: ["element"] },
  api: { root: ["resource"], child: ["endpoint"] },
  db: { root: ["table"], child: [], deriveChildren: columnRefs },
  batch: { root: ["job"], child: [] },
};

/** Node kinds that define a ref in some namespace. */
export const DEFINING_KINDS: ReadonlySet<NodeKind> = new Set(
  Object.values(REF_DEFINERS).flatMap((d) => [...d.root, ...d.child]),
);

/** Whether a node defines the ref it carries, rather than pointing at one defined elsewhere. */
export function definesRef(node: Pick<BoardNode, "kind" | "ref">): boolean {
  if (node.ref === undefined) return false;
  const parsed = parseRef(node.ref);
  if (parsed === null) return false;
  const definer = REF_DEFINERS[parsed.namespace];
  const child = "platform" in parsed ? parsed.element !== undefined : parsed.child !== undefined;
  return (child ? definer.child : definer.root).includes(node.kind);
}

/** What a board is, from the nodes it holds: a screen, an overview, an API, a schema, jobs or a flow. */
export function boardKindOf(board: Pick<Board, "nodes">): AtlasBoardKind {
  const kinds = new Set(board.nodes.map((n) => n.kind));
  if (kinds.has("element")) return "screen";
  if (kinds.has("screen")) return "overview";
  if (kinds.has("resource") || kinds.has("endpoint")) return "api";
  if (kinds.has("table")) return "db";
  if (kinds.has("job")) return "batch";
  return "flow";
}

export interface RefPlace {
  ref: string;
  nodeId: string;
  edgeId?: string;
  /** The kind of the node that defines the ref, for a definition. */
  kind?: NodeKind;
  /**
   * For a definition: the text the defining node shows (a button's caption), so a reader who
   * does not know the ref can tell which control it is. Not set on refs a node derives, such as
   * a table's columns.
   */
  label?: string;
  /** For the definition of an element that has one: what it is drawn as (button, link, ...). */
  role?: ElementRole;
  /**
   * On an element: it calls an API or changes state. On an endpoint: its handler has logic. A
   * flow should cover its ref either way.
   */
  needsFlow?: true;
  /** On an endpoint whose handler has logic: the board that should explain it. */
  flowShape?: HandlerShape;
  /** On the definition of a screen marked `layout: true`. */
  layout?: true;
  /** On a ref a screen lists in its `layouts`. */
  asLayout?: true;
}

/** The ids of the nodes an edge that calls an API or changes state starts from. */
function flowSourceIds(board: Pick<Board, "edges">): Set<string> {
  const ids = new Set<string>();
  for (const edge of board.edges) {
    if ((FLOW_EDGE_KINDS as readonly BoardEdge["kind"][]).includes(edge.kind)) ids.add(edge.from);
  }
  return ids;
}

/**
 * The elements that call an API or change state but carry no ref, so no flow can point at them.
 * Their ids, in board order.
 */
export function unlinkedFlowElements(board: Pick<Board, "nodes" | "edges">): string[] {
  const sources = flowSourceIds(board);
  return board.nodes
    .filter((n) => n.kind === "element" && n.ref === undefined && sources.has(n.id))
    .map((n) => n.id);
}

/**
 * The ids of the elements that carry a ref of one of their screen's `layouts`: each points at
 * the element the layout board defines, rather than defining a ref of its own.
 */
export function layoutPointerIds(board: Pick<Board, "nodes">): Set<string> {
  const ids = new Set<string>();
  if (!board.nodes.some((n) => n.kind === "screen" && n.layouts !== undefined)) return ids;
  const byId = new Map<string, BoardNode>();
  for (const node of board.nodes) if (!byId.has(node.id)) byId.set(node.id, node);
  const roots = stateRoots(board);
  for (const node of board.nodes) {
    if (node.kind !== "element" || node.ref === undefined) continue;
    const parsed = parseRef(node.ref);
    if (parsed === null || !("platform" in parsed)) continue;
    const rootId = familyOf(node.id, byId, roots);
    const root = rootId === undefined ? undefined : byId.get(rootId);
    if (root?.ref === undefined || parsed.screenRef === root.ref) continue;
    if (root.layouts?.includes(parsed.screenRef)) ids.add(node.id);
  }
  return ids;
}

/** The refs a board defines and the refs it points at, each with the node or edge it is on. */
export function refsOf(board: Pick<Board, "nodes" | "edges">): {
  defined: RefPlace[];
  used: RefPlace[];
} {
  const defined: RefPlace[] = [];
  const used: RefPlace[] = [];
  // An element needs a flow when it starts a `calls` or `transition` edge on its own board.
  const sources = flowSourceIds(board);
  const pointers = layoutPointerIds(board);
  for (const node of board.nodes) {
    if (node.ref !== undefined) {
      const place: RefPlace = { ref: node.ref, nodeId: node.id };
      if (node.kind === "element" && sources.has(node.id)) place.needsFlow = true;
      if (node.kind === "endpoint" && node.handler !== undefined) {
        place.needsFlow = true;
        place.flowShape = node.handler.shape;
      }
      if (definesRef(node) && !pointers.has(node.id)) {
        place.kind = node.kind;
        if (node.label !== undefined) place.label = node.label;
        if (node.role !== undefined) place.role = node.role;
        if (node.kind === "screen" && node.layout === true) place.layout = true;
        defined.push(place);
      } else used.push(place);
    }
    if (node.kind === "screen") {
      for (const layout of node.layouts ?? []) {
        used.push({ ref: layout, nodeId: node.id, asLayout: true });
      }
    }
    const parsed = node.ref === undefined ? null : parseRef(node.ref);
    const derive = parsed ? REF_DEFINERS[parsed.namespace].deriveChildren : undefined;
    if (derive && definesRef(node)) {
      for (const ref of derive(node)) defined.push({ ref, nodeId: node.id, kind: node.kind });
    }
  }
  for (const edge of board.edges) {
    if (edge.toRef !== undefined)
      used.push({ ref: edge.toRef, nodeId: edge.from, edgeId: edge.id });
    // A message names what it reaches; like a toRef, it explains nothing by itself.
    if (edge.ref !== undefined) used.push({ ref: edge.ref, nodeId: edge.from, edgeId: edge.id });
  }
  return { defined, used };
}

/**
 * Whether a ref is defined too often, given where it is defined and the kind of each of those
 * boards. A screen may be defined once on an overview and once on its own screen board (and
 * once on a flow); anything else, once in the whole atlas.
 */
export function isDefinedTwice(
  definedIn: ReadonlyArray<{ slug: string; kind?: NodeKind }>,
  boardKind: (slug: string) => AtlasBoardKind | undefined,
): boolean {
  const isScreen = definedIn.some((d) => d.kind === "screen");
  if (!isScreen) return definedIn.length > 1;
  return (["overview", "screen", "flow"] as const).some(
    (k) => definedIn.filter((d) => boardKind(d.slug) === k).length > 1,
  );
}

/** The first-level ref a second-level one belongs to; the ref itself for a first-level one. */
export const refRoot = (ref: string): string => rootRefOf(ref) ?? ref;

/** A ref across the atlas: where it is defined and where it is pointed at. */
export interface RefUse {
  ref: string;
  definedIn: ReadonlyArray<{ slug: string; nodeId: string; kind?: NodeKind; layout?: boolean }>;
  usedIn: ReadonlyArray<{ slug: string; nodeId: string; edgeId?: string; asLayout?: boolean }>;
  /** An element that calls an API or changes state, so a flow should cover it. */
  needsFlow?: boolean;
  /** On an endpoint whose handler has logic: the board that should explain it. */
  flowShape?: HandlerShape;
}

/**
 * Whether a flow covers a ref: some node that is not on a screen board carries it. A node, not
 * an edge's `toRef` or a screen's `layouts`, and on a board of known kind (an invalid board
 * counts for nothing).
 */
export function hasFlow(
  entry: Pick<RefUse, "usedIn">,
  boardKind: (slug: string) => AtlasBoardKind | undefined,
): boolean {
  return entry.usedIn.some((u) => {
    if (u.edgeId !== undefined || u.asLayout === true) return false;
    const kind = boardKind(u.slug);
    return kind !== undefined && kind !== "screen";
  });
}

/** The refs that need a flow and have none, in the order given. */
export function missingFlowRefs(
  refs: readonly RefUse[],
  boardKind: (slug: string) => AtlasBoardKind | undefined,
): string[] {
  return refs.filter((r) => r.needsFlow === true && !hasFlow(r, boardKind)).map((r) => r.ref);
}

const KIND_NAMES: Partial<Record<NodeKind, string>> = {
  element: "element",
  resource: "resource",
  endpoint: "endpoint",
  table: "table",
  job: "job",
};

/**
 * The problems of the refs of an atlas: a ref pointed at that no board defines, a ref defined
 * more often than `isDefinedTwice` allows, and a screen listed in `layouts` that is not marked
 * `layout: true`. In ref order.
 */
export function refProblems(
  refs: readonly RefUse[],
  boardKind: (slug: string) => AtlasBoardKind | undefined,
): Array<{ path: string; message: string }> {
  const problems: Array<{ path: string; message: string }> = [];
  const where = (places: ReadonlyArray<{ slug: string; nodeId: string }>) =>
    places.map((p) => `${p.slug} (${p.nodeId})`).join(", ");
  for (const entry of refs) {
    if (entry.definedIn.length === 0) {
      problems.push({
        path: entry.ref,
        message: `ref \`${entry.ref}\` is used in ${where(entry.usedIn)} but no board defines it`,
      });
      continue;
    }
    const listedAsLayout = entry.usedIn.filter((u) => u.asLayout === true);
    if (listedAsLayout.length > 0 && !entry.definedIn.some((d) => d.layout === true)) {
      problems.push({
        path: entry.ref,
        message: `\`${entry.ref}\` is listed in the layouts of ${where(listedAsLayout)} but is not a layout; mark its screen node \`"layout": true\` on its own board (${where(entry.definedIn)})`,
      });
    }
    if (!isDefinedTwice(entry.definedIn, boardKind)) continue;
    const isScreen = entry.definedIn.some((d) => d.kind === "screen");
    const what = KIND_NAMES[entry.definedIn[0]?.kind as NodeKind] ?? "ref";
    problems.push({
      path: entry.ref,
      message: isScreen
        ? `screen ref \`${entry.ref}\` is defined in ${where(entry.definedIn)}; define a screen at most once on an overview and once on its own screen board, and point at it from elsewhere with toRef`
        : `${what} ref \`${entry.ref}\` is defined in ${where(entry.definedIn)}; define it on one board and refer to it elsewhere`,
    });
  }
  return problems;
}
