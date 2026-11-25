import type { Board, BoardNode, NodeKind } from "./board.ts";
import { parseRef, type RefNamespace, rootRefOf } from "./ref.ts";
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
}

/** The refs a board defines and the refs it points at, each with the node or edge it is on. */
export function refsOf(board: Pick<Board, "nodes" | "edges">): {
  defined: RefPlace[];
  used: RefPlace[];
} {
  const defined: RefPlace[] = [];
  const used: RefPlace[] = [];
  for (const node of board.nodes) {
    if (node.ref !== undefined) {
      if (definesRef(node)) defined.push({ ref: node.ref, nodeId: node.id, kind: node.kind });
      else used.push({ ref: node.ref, nodeId: node.id });
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
  definedIn: ReadonlyArray<{ slug: string; nodeId: string; kind?: NodeKind }>;
  usedIn: ReadonlyArray<{ slug: string; nodeId: string }>;
}

const KIND_NAMES: Partial<Record<NodeKind, string>> = {
  element: "element",
  resource: "resource",
  endpoint: "endpoint",
  table: "table",
  job: "job",
};

/**
 * The problems of the refs of an atlas: a ref pointed at that no board defines, and a ref
 * defined more often than `isDefinedTwice` allows. In ref order.
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
