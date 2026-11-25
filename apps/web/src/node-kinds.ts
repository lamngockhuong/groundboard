import {
  type AtlasBoardKind,
  type Board,
  boardKindOf,
  columnSlug,
  type NodeKind,
} from "@groundboard/schema";

/** The kinds a new node can take, grouped by the kind of board they are drawn on. */
export const KIND_GROUPS = [
  {
    id: "flow",
    kinds: ["step", "state", "decision", "cause", "rejected", "fact", "question", "note"],
  },
  { id: "screen", kinds: ["screen", "element"] },
  { id: "api", kinds: ["resource", "endpoint"] },
  { id: "db", kinds: ["table"] },
  { id: "batch", kinds: ["job"] },
] as const satisfies ReadonlyArray<{ id: string; kinds: readonly NodeKind[] }>;

export type KindGroup = (typeof KIND_GROUPS)[number];

/** An overview maps screens, so its nodes come from the screen group. */
const GROUP_OF_BOARD: Record<AtlasBoardKind, KindGroup["id"]> = {
  flow: "flow",
  overview: "screen",
  screen: "screen",
  api: "api",
  db: "db",
  batch: "batch",
};

/**
 * The groups in the order the picker lists them: the group that fits the board first, the rest
 * after it in their usual order, so a board that mixes kinds can still add any of them.
 */
export function kindGroupsFor(nodes: ReadonlyArray<Record<string, unknown>>): KindGroup[] {
  // `boardKindOf` reads only each node's kind, which an unvalidated board may lack.
  const kinded = nodes.filter((n) => typeof n.kind === "string") as unknown as Board["nodes"];
  const first = GROUP_OF_BOARD[boardKindOf({ nodes: kinded })];
  return [...KIND_GROUPS].sort((a, b) => Number(b.id === first) - Number(a.id === first));
}

/** The namespace of the ref each kind defines, for the kinds whose ref is `<namespace>:<slug>`. */
const REF_NAMESPACE_OF = {
  resource: "api",
  table: "db",
  job: "batch",
} as const satisfies Partial<Record<NodeKind, string>>;

/**
 * The ref a new node gets when the person leaves the field empty, made from its label:
 * `db:don-hang` for a table labelled "Đơn hàng". Null when the kind takes no such ref or the
 * label gives no slug.
 */
export function suggestedRef(kind: string, label: string, platform: string): string | null {
  const namespace =
    kind === "screen" ? platform : REF_NAMESPACE_OF[kind as keyof typeof REF_NAMESPACE_OF];
  if (namespace === undefined) return null;
  // Strip the marks so "Đơn hàng" reads "don hang", not "n-h-ng".
  const plain = label.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D");
  const slug = columnSlug(plain);
  return slug === null ? null : `${namespace}:${slug}`;
}
