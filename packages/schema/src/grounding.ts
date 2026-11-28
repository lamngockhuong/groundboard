import {
  type Board,
  type BoardEdge,
  type BoardNode,
  type BoardSource,
  GROUNDED_KINDS,
  INTERACTIVE_ROLES,
} from "./board.ts";
import { isClaimEdge } from "./edges.ts";

export type SourceTier = "code" | "spec";
/** `always`: file, lines and quote are checked; `when-path`: the file's existence, if it has a path; `never`: not checkable offline. */
export type SourceCheckable = "always" | "when-path" | "never";

/**
 * Every source kind with its tier and whether it can be checked. Validation, `atlas check`,
 * the renderer and the viewer read this table instead of listing kinds themselves.
 */
export const SOURCE_KINDS = {
  code: { tier: "code", checkable: "always" },
  doc: { tier: "spec", checkable: "always" },
  mockup: { tier: "spec", checkable: "when-path" },
  figma: { tier: "spec", checkable: "never" },
  link: { tier: "spec", checkable: "never" },
} as const satisfies Record<BoardSource["kind"], { tier: SourceTier; checkable: SourceCheckable }>;

/**
 * How well a claim is grounded: `code` when it cites a quoted code source, `spec` when it cites
 * only specification sources (documents, Figma, mockups, links), `none` when it cites nothing
 * usable or is an element marked `unresolved`.
 */
export type Grounding = "code" | "spec" | "none";
export const GROUNDINGS: readonly Grounding[] = ["code", "spec", "none"];

const hasText = (text: string | undefined) => text !== undefined && text.trim() !== "";

/** Whether the source is checked against the files under the root. */
export function isCheckable(source: BoardSource): boolean {
  const { checkable } = SOURCE_KINDS[source.kind];
  return (
    checkable === "always" ||
    (checkable === "when-path" && source.kind === "mockup" && source.path !== undefined)
  );
}

/**
 * Whether a source can back an action or a navigation: a quoted code source, a document, a
 * Figma node, a committed mockup file, or a link with a quoted passage. A mockup without a
 * file or a link without a quote locates nothing, so it backs only screens and layout.
 */
export function isBehaviourSource(source: BoardSource): boolean {
  switch (source.kind) {
    case "code":
      return hasText(source.quote);
    case "doc":
      return hasText(source.quote);
    case "figma":
      return true;
    case "mockup":
      return source.path !== undefined;
    case "link":
      return hasText(source.quote);
    default: {
      const unknown: never = source;
      throw new Error(`unknown source kind ${JSON.stringify(unknown)}`);
    }
  }
}

/**
 * The grounding of a claim from the sources it cites. A code source without a quote does not
 * count as code; ids that name no source are ignored.
 */
export function groundingOf(
  sourceIds: readonly string[],
  sources: ReadonlyMap<string, BoardSource>,
): Grounding {
  let spec = false;
  for (const sourceId of sourceIds) {
    const source = sources.get(sourceId);
    if (source === undefined) continue;
    if (source.kind === "code") {
      if (hasText(source.quote)) return "code";
    } else if (SOURCE_KINDS[source.kind].tier === "spec") {
      spec = true;
    }
  }
  return spec ? "spec" : "none";
}

/**
 * The grounding of a node: `none` for an `unresolved` element and for a node a person added or
 * reworded (`manual`), otherwise from its sources.
 */
export function nodeGrounding(
  node: Pick<BoardNode, "sourceIds" | "unresolved" | "manual">,
  sources: ReadonlyMap<string, BoardSource>,
): Grounding {
  return node.unresolved !== undefined || node.manual === true
    ? "none"
    : groundingOf(node.sourceIds, sources);
}

const groundedKinds = new Set<string>(GROUNDED_KINDS);
const interactiveRoles = new Set<string>(INTERACTIVE_ROLES);

/** Ids of the nodes a navigates edge starts at; such an element is interactive. */
export function navigatesFromIds(edges: readonly BoardEdge[]): Set<string> {
  const ids = new Set<string>();
  for (const edge of edges) if (edge.kind === "navigates") ids.add(edge.from);
  return ids;
}

/** Whether an element is acted on: an interactive role, or the start of a navigates edge. */
export function isInteractiveElement(node: BoardNode, navigatesFrom: ReadonlySet<string>): boolean {
  return (
    node.kind === "element" &&
    ((node.role !== undefined && interactiveRoles.has(node.role)) || navigatesFrom.has(node.id))
  );
}

/**
 * Whether a node states a claim: a screen, an interactive element, a participant that is not a
 * person, or a node of a grounded kind. Questions, notes and non-interactive elements are not
 * claims.
 */
export function isClaimNode(node: BoardNode, navigatesFrom: ReadonlySet<string>): boolean {
  return (
    groundedKinds.has(node.kind) ||
    isInteractiveElement(node, navigatesFrom) ||
    (node.kind === "participant" && node.category !== undefined && node.category !== "person")
  );
}

export interface Claim {
  /** JSON path of the node, edge or operand, e.g. `nodes[3]`, `fragments[0].operands[1]`. */
  path: string;
  id: string;
  /**
   * `operand`: the guard of a fragment's operand on a sequence board. `guard` and `handler`: a
   * guard of an endpoint (`id` the endpoint's, `index` the guard's) and its handler's logic.
   */
  on: "node" | "edge" | "operand" | "guard" | "handler";
  /** For a guard: its place in the endpoint's `guards`. */
  index?: number;
  grounding: Grounding;
  /** Added or reworded by a person in the viewer, so not checked: always `none`. */
  manual?: true;
}

/**
 * Whether an edge states a claim: an edge of a kind in `CLAIM_EDGE_KINDS` (a navigation, a
 * call), or a transition that ends at a screen (a change of state on one screen). Transitions
 * between `state` nodes are not claims.
 */
export const isScreenEdgeClaim = isClaimEdge;

/**
 * Every claim of a board with its grounding, nodes first, then the guards and handlers of
 * endpoints, then edges, then the guards of fragment operands, in board order.
 */
export function boardClaims(
  board: Pick<Board, "nodes" | "edges" | "sources"> & Partial<Pick<Board, "fragments">>,
): Claim[] {
  const sources = new Map(board.sources.map((s) => [s.id, s]));
  const navigatesFrom = navigatesFromIds(board.edges);
  const claims: Claim[] = [];
  board.nodes.forEach((node, i) => {
    if (!isClaimNode(node, navigatesFrom)) return;
    claims.push({
      path: `nodes[${i}]`,
      id: node.id,
      on: "node",
      grounding: nodeGrounding(node, sources),
      ...(node.manual ? { manual: true as const } : {}),
    });
  });
  // An endpoint's guards and its handler cite sources of their own, so each is a claim.
  board.nodes.forEach((node, i) => {
    if (node.kind !== "endpoint") return;
    const manual = node.manual ? { manual: true as const } : {};
    node.guards?.forEach((guard, j) => {
      claims.push({
        path: `nodes[${i}].guards[${j}]`,
        id: node.id,
        on: "guard",
        index: j,
        grounding: node.manual ? "none" : groundingOf(guard.sourceIds, sources),
        ...manual,
      });
    });
    if (node.handler !== undefined) {
      claims.push({
        path: `nodes[${i}].handler`,
        id: node.id,
        on: "handler",
        grounding: node.manual ? "none" : groundingOf(node.handler.sourceIds, sources),
        ...manual,
      });
    }
  });
  const screens = new Set(board.nodes.filter((n) => n.kind === "screen").map((n) => n.id));
  board.edges.forEach((edge, i) => {
    if (!isScreenEdgeClaim(edge, screens)) return;
    claims.push({
      path: `edges[${i}]`,
      id: edge.id,
      on: "edge",
      grounding: edge.manual ? "none" : groundingOf(edge.sourceIds, sources),
      ...(edge.manual ? { manual: true as const } : {}),
    });
  });
  (board.fragments ?? []).forEach((fragment, f) => {
    fragment.operands.forEach((operand, o) => {
      if (operand.guard === undefined) return;
      const manual = operand.manual === true || fragment.manual === true;
      claims.push({
        path: `fragments[${f}].operands[${o}]`,
        id: operand.id,
        on: "operand",
        grounding: manual ? "none" : groundingOf(operand.sourceIds, sources),
        ...(manual ? { manual: true as const } : {}),
      });
    });
  });
  return claims;
}

/** How many claims sit at each grounding. */
export function countGrounding(claims: readonly Claim[]): Record<Grounding, number> {
  const counts: Record<Grounding, number> = { code: 0, spec: 0, none: 0 };
  for (const claim of claims) counts[claim.grounding]++;
  return counts;
}
