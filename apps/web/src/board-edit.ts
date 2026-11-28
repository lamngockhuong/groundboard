import { type Issue, parseBoard } from "@groundboard/schema";

/**
 * Edits a person makes to a board in the viewer. Each one takes the board's raw JSON and
 * returns new raw JSON, every field it does not touch kept as written (parsing a board fills in
 * defaults, so edits never go through the parsed form). What a person adds or rewords becomes
 * `manual`: counted as unresolved, and drawn so; a reworded claim's sources move to
 * `priorSourceIds`, so a reader that does not know `manual` refuses the board rather than taking
 * the new text as checked.
 */

export type RawBoard = Record<string, unknown>;
type Item = Record<string, unknown>;

export type EditResult = { ok: true; board: RawBoard } | { ok: false; issues: Issue[] };

const items = (board: RawBoard, key: "nodes" | "edges" | "sources"): Item[] =>
  Array.isArray(board[key]) ? (board[key] as Item[]) : [];
const ids = (list: readonly Item[]) => list.map((item) => item.id);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** The board if it is valid, else what is wrong with it: an edit never leaves a broken board. */
export function checked(board: RawBoard): EditResult {
  const parsed = parseBoard(board);
  return parsed.ok ? { ok: true, board } : { ok: false, issues: parsed.error };
}

/** An item marked as changed by a person, its sources moved to `priorSourceIds`. */
export function asManual(item: Item): Item {
  const cited = strings(item.sourceIds);
  const out: Item = { ...item, manual: true };
  if (cited.length > 0) {
    out.priorSourceIds = [...new Set([...strings(item.priorSourceIds), ...cited])];
  }
  delete out.sourceIds;
  return out;
}

/** A fresh id `m-` and six characters, unused on the board. */
export function newId(board: RawBoard, random: () => number = Math.random): string {
  // Fragments and their operands share the board's ids with nodes and edges.
  const fragments = Array.isArray(board.fragments) ? (board.fragments as Item[]) : [];
  const taken = new Set([
    ...ids(items(board, "nodes")),
    ...ids(items(board, "edges")),
    ...ids(fragments),
    ...ids(operandsOf(board)),
  ]);
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (;;) {
    let id = "m-";
    for (let i = 0; i < 6; i += 1) id += alphabet[Math.floor(random() * alphabet.length)];
    if (!taken.has(id)) return id;
  }
}

/** The text fields of a node a person may change. */
export const NODE_TEXT_FIELDS = ["label", "detail", "action", "unresolved"] as const;
export type NodeTextField = (typeof NODE_TEXT_FIELDS)[number];

/**
 * Sets one text field of a node; an empty optional field is removed. Changing the text makes
 * the node manual. Setting the text it already has changes nothing.
 */
export function setNodeText(
  board: RawBoard,
  nodeId: string,
  field: NodeTextField,
  value: string,
): EditResult {
  const nodes = items(board, "nodes");
  const at = nodes.findIndex((n) => n.id === nodeId);
  const node = nodes[at];
  if (!node) return { ok: false, issues: [{ path: "", message: `no node \`${nodeId}\`` }] };
  const text = value.trim();
  if ((node[field] ?? "") === text) return { ok: true, board };
  const next = asManual(node);
  if (text === "" && field !== "label") delete next[field];
  else next[field] = text;
  const out = [...nodes];
  out[at] = next;
  return checked({ ...board, nodes: out });
}

/** Sets an edge's label; an empty label is removed. Changing it makes the edge manual. */
export function setEdgeLabel(board: RawBoard, edgeId: string, value: string): EditResult {
  const edges = items(board, "edges");
  const at = edges.findIndex((e) => e.id === edgeId);
  const edge = edges[at];
  if (!edge) return { ok: false, issues: [{ path: "", message: `no edge \`${edgeId}\`` }] };
  const text = value.trim();
  if ((edge.label ?? "") === text) return { ok: true, board };
  const next = asManual(edge);
  if (text === "") delete next.label;
  else next.label = text;
  const out = [...edges];
  out[at] = next;
  return checked({ ...board, edges: out });
}

/** What a new node needs besides its kind and label; each kind checks its own. */
export interface NewNode {
  kind: string;
  label: string;
  /** element: the screen or element it sits in, and what it is drawn as. */
  parentId?: string;
  role?: string;
  /** screen: its ref, platform and where its layout comes from. */
  ref?: string;
  platform?: string;
  layoutFrom?: string;
  groupId?: string;
  /** endpoint: its method and path; resource: the prefix of its paths. */
  method?: string;
  path?: string;
  pathPrefix?: string;
  /** job: what starts it. */
  trigger?: { type: string; schedule?: string; queue?: string; event?: string };
  /** participant: what it is. */
  category?: string;
}

/** Adds a node a person describes, marked manual and citing nothing. */
export function addNode(
  board: RawBoard,
  spec: NewNode,
  random?: () => number,
): EditResult & { id?: string } {
  const id = newId(board, random);
  const node: Item = { id, kind: spec.kind, label: spec.label.trim(), manual: true };
  for (const key of [
    "parentId",
    "role",
    "ref",
    "platform",
    "layoutFrom",
    "groupId",
    "method",
    "path",
    "pathPrefix",
    "category",
  ] as const) {
    const value = spec[key]?.trim();
    if (value) node[key] = value;
  }
  if (spec.trigger) {
    const { type, ...rest } = spec.trigger;
    const fields = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => typeof v === "string" && v.trim() !== ""),
    );
    node.trigger = { type, ...fields };
  }
  const result = checked({ ...board, nodes: [...items(board, "nodes"), node] });
  return result.ok ? { ...result, id } : result;
}

/** Ids of the node and everything that goes with it: its elements and, for a screen, its states. */
function withDependants(board: RawBoard, nodeId: string): Set<string> {
  const nodes = items(board, "nodes");
  const gone = new Set([nodeId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      const id = String(node.id);
      if (gone.has(id)) continue;
      if (gone.has(String(node.parentId)) || gone.has(String(node.stateOf))) {
        gone.add(id);
        grew = true;
      }
    }
  }
  return gone;
}

/** The sources an item cites, those of its parts included: guards, handler, columns. */
function citesOf(item: Item): string[] {
  const parts = [
    ...(Array.isArray(item.guards) ? (item.guards as Item[]) : []),
    ...(Array.isArray(item.columns) ? (item.columns as Item[]) : []),
    ...(typeof item.handler === "object" && item.handler !== null ? [item.handler as Item] : []),
  ];
  return [item, ...parts].flatMap((i) => [...strings(i.sourceIds), ...strings(i.priorSourceIds)]);
}

/** The operands of a sequence board's fragments: they cite sources as nodes and edges do. */
export function operandsOf(board: RawBoard): Item[] {
  const fragments = Array.isArray(board.fragments) ? (board.fragments as Item[]) : [];
  return fragments.flatMap((f) => (Array.isArray(f.operands) ? (f.operands as Item[]) : []));
}

/** Sources the removed items cited that nothing left on the board cites. */
export function orphanedSources(board: RawBoard, removed: (item: Item) => boolean): string[] {
  const all = [...items(board, "nodes"), ...items(board, "edges")];
  const kept = new Set([
    ...all.filter((i) => !removed(i)).flatMap(citesOf),
    ...operandsOf(board).flatMap(citesOf),
  ]);
  return [...new Set(all.filter(removed).flatMap(citesOf))].filter((id) => !kept.has(id));
}

/** What removing a node takes with it, to say before asking. */
export function removalOf(
  board: RawBoard,
  nodeId: string,
): { nodes: string[]; edges: string[]; sources: string[] } {
  const nodes = withDependants(board, nodeId);
  const edges = items(board, "edges")
    .filter((e) => nodes.has(String(e.from)) || nodes.has(String(e.to)))
    .map((e) => String(e.id));
  const goneEdges = new Set(edges);
  const sources = orphanedSources(
    board,
    (item) => nodes.has(String(item.id)) || goneEdges.has(String(item.id)),
  );
  return { nodes: [...nodes], edges, sources };
}

/**
 * Removes a node with its elements and states, every edge that touches any of them, and the
 * sources nothing cites any more.
 */
export function removeNode(board: RawBoard, nodeId: string): EditResult {
  const { nodes, edges, sources } = removalOf(board, nodeId);
  const goneNodes = new Set(nodes);
  const goneEdges = new Set(edges);
  const goneSources = new Set(sources);
  const out: RawBoard = {
    ...board,
    nodes: items(board, "nodes").filter((n) => !goneNodes.has(String(n.id))),
    edges: items(board, "edges").filter((e) => !goneEdges.has(String(e.id))),
  };
  if (Array.isArray(board.sources)) {
    out.sources = items(board, "sources").filter((s) => !goneSources.has(String(s.id)));
  }
  return checked(out);
}

export interface NewEdge {
  from: string;
  to?: string;
  toRef?: string;
  kind: string;
  label?: string;
}

/** Adds an edge a person draws between two nodes, marked manual and citing nothing. */
export function addEdge(
  board: RawBoard,
  spec: NewEdge,
  random?: () => number,
): EditResult & { id?: string } {
  const id = newId(board, random);
  const edge: Item = { id, from: spec.from, kind: spec.kind, manual: true };
  if (spec.to) edge.to = spec.to;
  if (spec.toRef) edge.toRef = spec.toRef;
  const label = spec.label?.trim();
  if (label) edge.label = label;
  const result = checked({ ...board, edges: [...items(board, "edges"), edge] });
  return result.ok ? { ...result, id } : result;
}

/** Removes an edge, and the sources it cited that nothing else cites. */
export function removeEdge(board: RawBoard, edgeId: string): EditResult {
  const gone = new Set(orphanedSources(board, (item) => item.id === edgeId && "from" in item));
  const out: RawBoard = { ...board, edges: items(board, "edges").filter((e) => e.id !== edgeId) };
  if (Array.isArray(board.sources)) {
    out.sources = items(board, "sources").filter((s) => !gone.has(String(s.id)));
  }
  return checked(out);
}

type Column = Record<string, unknown>;

/** A table's columns as the panel writes them: one per line, `name type [pk] [null] [unique]`. */
export function columnsText(columns: unknown): string {
  if (!Array.isArray(columns)) return "";
  return (columns as Column[])
    .map((c) =>
      [c.name, c.type, c.pk ? "pk" : "", c.nullable ? "null" : "", c.unique ? "unique" : ""]
        .filter((part) => typeof part === "string" && part !== "")
        .join(" "),
    )
    .join("\n");
}

/**
 * Replaces a table's columns with the ones written in the panel. A column kept under the same
 * name keeps its other fields (default, note, sources); the table becomes manual, its sources
 * moved to `priorSourceIds`, as any reworded claim.
 */
export function setTableColumns(board: RawBoard, tableId: string, text: string): EditResult {
  const nodes = items(board, "nodes");
  const at = nodes.findIndex((n) => n.id === tableId);
  const table = nodes[at];
  if (table?.kind !== "table") {
    return { ok: false, issues: [{ path: "", message: `no table \`${tableId}\`` }] };
  }
  const before = new Map(
    (Array.isArray(table.columns) ? (table.columns as Column[]) : []).map((c) => [c.name, c]),
  );
  const columns: Column[] = [];
  for (const line of text.split("\n")) {
    const [name, ...rest] = line.trim().split(/\s+/);
    if (!name) continue;
    const flags = new Set(rest.map((r) => r.toLowerCase()));
    const type = rest.find(
      (r) => !["pk", "null", "nullable", "unique", "uq"].includes(r.toLowerCase()),
    );
    const kept = { ...(before.get(name) ?? {}) };
    delete kept.type;
    delete kept.pk;
    delete kept.nullable;
    delete kept.unique;
    columns.push({
      ...kept,
      name,
      ...(type ? { type } : {}),
      ...(flags.has("pk") ? { pk: true } : {}),
      ...(flags.has("null") || flags.has("nullable") ? { nullable: true } : {}),
      ...(flags.has("unique") || flags.has("uq") ? { unique: true } : {}),
    });
  }
  if (columnsText(table.columns) === columnsText(columns)) return { ok: true, board };
  const next = asManual(table);
  next.columns = columns;
  const out = [...nodes];
  out[at] = next;
  return checked({ ...board, nodes: out });
}

interface Guard {
  name: string;
  sourceIds?: string[];
}

/** An endpoint's guards as the panel shows them: one name per line. */
export function guardsText(guards: unknown): string {
  if (!Array.isArray(guards)) return "";
  return (guards as Guard[])
    .map((g) => (typeof g.name === "string" ? g.name : ""))
    .filter((name) => name !== "")
    .join("\n");
}

/**
 * Replaces an endpoint's guards with the ones written in the panel, one per line. A guard kept
 * under the same name keeps its sources; clearing every line leaves an empty list, which says
 * the handler has no guard. The endpoint becomes manual, its sources moved to `priorSourceIds`.
 */
export function setEndpointGuards(board: RawBoard, endpointId: string, text: string): EditResult {
  const nodes = items(board, "nodes");
  const at = nodes.findIndex((n) => n.id === endpointId);
  const endpoint = nodes[at];
  if (endpoint?.kind !== "endpoint") {
    return { ok: false, issues: [{ path: "", message: `no endpoint \`${endpointId}\`` }] };
  }
  const before = new Map(
    (Array.isArray(endpoint.guards) ? (endpoint.guards as Guard[]) : []).map((g) => [g.name, g]),
  );
  const names = [...new Set(text.split("\n").map((line) => line.trim()))].filter(Boolean);
  if (guardsText(endpoint.guards) === names.join("\n")) return { ok: true, board };
  const next = asManual(endpoint);
  next.guards = names.map((name) => ({ ...(before.get(name) ?? {}), name }));
  const out = [...nodes];
  out[at] = next;
  return checked({ ...board, nodes: out });
}
