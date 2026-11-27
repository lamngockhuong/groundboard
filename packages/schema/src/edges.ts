import type { BoardEdge, EdgeKind } from "./board.ts";
import type { RefNamespace } from "./ref.ts";

/**
 * Which edges state a claim, and which may point at a ref on another board. Validation,
 * grounding, layout and the renderer read these tables instead of listing kinds themselves.
 */

/**
 * Edge kinds that always state a claim: each must cite a source (or be `manual`). A
 * `transition` that ends at a screen is a claim as well; `isClaimEdge` says so.
 */
export const CLAIM_EDGE_KINDS: readonly EdgeKind[] = [
  "navigates",
  "calls",
  "references",
  "reads",
  "writes",
  "enqueues",
];

/**
 * Edge kinds that may point at a ref defined on another board (`toRef`), with the namespaces
 * that ref may be in and whether it names a first-level item (a screen, a table), a
 * second-level one (an endpoint), or either (a table or one of its columns).
 */
export const REF_EDGE_KINDS: Partial<
  Record<EdgeKind, { namespaces: readonly RefNamespace[]; level: "root" | "child" | "any" }>
> = {
  navigates: { namespaces: ["web", "mobile"], level: "root" },
  calls: { namespaces: ["api"], level: "child" },
  references: { namespaces: ["db"], level: "root" },
  reads: { namespaces: ["db"], level: "any" },
  writes: { namespaces: ["db"], level: "any" },
  enqueues: { namespaces: ["batch"], level: "root" },
};

/** Edge kinds by which an element calls an API or changes state, so a flow should cover it. */
export const FLOW_EDGE_KINDS = ["calls", "transition"] as const satisfies readonly EdgeKind[];

/** Whether an edge states a claim: a claim kind, or a transition that ends at a screen. */
export function isClaimEdge(
  edge: Pick<BoardEdge, "kind" | "to">,
  screenIds: ReadonlySet<string>,
): boolean {
  return (
    CLAIM_EDGE_KINDS.includes(edge.kind) ||
    (edge.kind === "transition" && edge.to !== undefined && screenIds.has(edge.to))
  );
}

/** Whether an edge kind may carry a `toRef`. */
export function takesRef(kind: EdgeKind): boolean {
  return REF_EDGE_KINDS[kind] !== undefined;
}
