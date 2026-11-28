import {
  FRAGMENT_OPERANDS,
  type FragmentKind,
  operandChain,
  pruneFragments,
} from "@groundboard/schema";
import {
  asManual,
  checked,
  type EditResult,
  newId,
  orphanedSources,
  type RawBoard,
} from "./board-edit.ts";

/**
 * Edits a person makes to a sequence board in the viewer, on its raw JSON like `board-edit.ts`:
 * every field an edit does not touch is kept as written, and an edit that would leave a broken
 * board is refused with the issues. A claim a person changes becomes `manual` (its sources move to
 * `priorSourceIds`); moving a participant is only presentation and changes no claim, while moving
 * a message changes the order it states, so that message becomes manual.
 */

type Item = Record<string, unknown>;

const list = (board: RawBoard, key: "nodes" | "edges" | "fragments"): Item[] =>
  Array.isArray(board[key]) ? (board[key] as Item[]) : [];
const refuse = (message: string): EditResult => ({ ok: false, issues: [{ path: "", message }] });
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

interface FragmentLike {
  id: string;
  kind?: string;
  parentOperandId?: string;
  operands: Array<{ id: string }>;
}

const fragmentsOf = (board: RawBoard): FragmentLike[] =>
  list(board, "fragments").map((f) => ({
    id: String(f.id),
    kind: str(f.kind),
    ...(str(f.parentOperandId) !== undefined ? { parentOperandId: str(f.parentOperandId) } : {}),
    operands: (Array.isArray(f.operands) ? (f.operands as Item[]) : []).map((o) => ({
      id: String(o.id),
    })),
  }));

/** The messages in message order, each with its index in `edges`. */
function messages(board: RawBoard): Array<{ edge: Item; at: number }> {
  return list(board, "edges")
    .map((edge, at) => ({ edge, at }))
    .filter(({ edge }) => edge.kind === "message");
}

/** The operands containing a message, outermost first. */
function chainOf(board: RawBoard, edge: Item | undefined): string[] {
  const operandId = edge === undefined ? undefined : str(edge.operandId);
  return operandId === undefined ? [] : operandChain(operandId, fragmentsOf(board)).reverse();
}

/** The fragment an operand belongs to, with the operand's index among its operands. */
function ownerOf(
  board: RawBoard,
  operandId: string,
): { fragment: FragmentLike; index: number } | null {
  for (const fragment of fragmentsOf(board)) {
    const index = fragment.operands.findIndex((o) => o.id === operandId);
    if (index >= 0) return { fragment, index };
  }
  return null;
}

/** Sets or removes a message's operand. */
function withOperand(edge: Item, operandId: string | undefined): Item {
  const out = { ...edge };
  if (operandId === undefined) delete out.operandId;
  else out.operandId = operandId;
  return out;
}

/** Replaces one edge, tidies the fragments, and checks the result. */
function finish(board: RawBoard, edges: Item[], fragments?: Item[]): EditResult {
  const next: RawBoard = { ...board, edges };
  if (fragments !== undefined) {
    if (fragments.length > 0) next.fragments = fragments;
    else delete next.fragments;
  }
  return checked(pruneFragments(next));
}

// ---------------------------------------------------------------------------------------------
// Participants

/** Changes what a participant is; the participant becomes manual. */
export function setParticipantCategory(
  board: RawBoard,
  nodeId: string,
  category: string,
): EditResult {
  const nodes = list(board, "nodes");
  const at = nodes.findIndex((n) => n.id === nodeId && n.kind === "participant");
  const node = nodes[at];
  if (!node) return refuse(`no participant \`${nodeId}\``);
  if (node.category === category) return { ok: true, board };
  const out = [...nodes];
  out[at] = { ...asManual(node), category };
  return checked({ ...board, nodes: out });
}

/** Adds a participant after `afterId` (at the end without one), manual and citing nothing. */
export function addParticipant(
  board: RawBoard,
  spec: { label: string; category: string; afterId?: string },
  random?: () => number,
): EditResult & { id?: string } {
  const id = newId(board, random);
  const nodes = list(board, "nodes");
  const node: Item = {
    id,
    kind: "participant",
    category: spec.category,
    label: spec.label.trim(),
    manual: true,
  };
  const after = spec.afterId === undefined ? -1 : nodes.findIndex((n) => n.id === spec.afterId);
  const lastParticipant = nodes.reduce((last, n, i) => (n.kind === "participant" ? i : last), -1);
  const at = (after >= 0 ? after : lastParticipant) + 1;
  const result = checked({ ...board, nodes: [...nodes.slice(0, at), node, ...nodes.slice(at)] });
  return result.ok ? { ...result, id } : result;
}

/** The messages that go when a participant goes: every one it sends or receives. */
export function participantRemoval(board: RawBoard, nodeId: string): string[] {
  return messages(board)
    .filter(({ edge }) => edge.from === nodeId || edge.to === nodeId)
    .map(({ edge }) => String(edge.id));
}

/** Removes a participant with its messages and the sources nothing cites any more. */
export function removeParticipant(board: RawBoard, nodeId: string): EditResult {
  const goneEdges = new Set(participantRemoval(board, nodeId));
  const goneSources = new Set(
    orphanedSources(board, (item) => item.id === nodeId || goneEdges.has(String(item.id))),
  );
  const next: RawBoard = {
    ...board,
    nodes: list(board, "nodes").filter((n) => n.id !== nodeId),
    edges: list(board, "edges").filter((e) => !goneEdges.has(String(e.id))),
  };
  if (Array.isArray(board.sources)) {
    next.sources = (board.sources as Item[]).filter((s) => !goneSources.has(String(s.id)));
  }
  return checked(pruneFragments(next));
}

/**
 * Moves a participant one column left (-1) or right (+1): it swaps places in `nodes` with the
 * participant beside it. Presentation only: nothing becomes manual.
 */
export function moveParticipant(board: RawBoard, nodeId: string, step: -1 | 1): EditResult {
  const nodes = list(board, "nodes");
  const columns = nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.kind === "participant");
  const k = columns.findIndex(({ n }) => n.id === nodeId);
  if (k < 0) return refuse(`no participant \`${nodeId}\``);
  const other = columns[k + step];
  if (!other) return refuse(step < 0 ? "already the first column" : "already the last column");
  const out = [...nodes];
  out[(columns[k] as { i: number }).i] = other.n;
  out[other.i] = (columns[k] as { n: Item }).n;
  return checked({ ...board, nodes: out });
}

// ---------------------------------------------------------------------------------------------
// Messages

export interface MessageChange {
  label?: string;
  messageType?: string;
  from?: string;
  to?: string;
}

/** Changes a message's label, type or participants; the message becomes manual. */
export function setMessage(board: RawBoard, edgeId: string, change: MessageChange): EditResult {
  const edges = list(board, "edges");
  const at = edges.findIndex((e) => e.id === edgeId && e.kind === "message");
  const edge = edges[at];
  if (!edge) return refuse(`no message \`${edgeId}\``);
  const next = { ...edge };
  if (change.label !== undefined) {
    const text = change.label.trim();
    if (text === "") delete next.label;
    else next.label = text;
  }
  if (change.messageType !== undefined) {
    if (change.messageType === "sync") delete next.messageType;
    else next.messageType = change.messageType;
  }
  if (change.from !== undefined) next.from = change.from;
  if (change.to !== undefined) next.to = change.to;
  if (JSON.stringify(next) === JSON.stringify(edge)) return { ok: true, board };
  const out = [...edges];
  out[at] = asManual(next);
  return checked({ ...board, edges: out });
}

/**
 * Adds a message right after `afterId`, in the same operand (at the end without one), manual
 * and citing nothing.
 */
export function addMessage(
  board: RawBoard,
  spec: { from: string; to: string; label: string; messageType?: string; afterId?: string },
  random?: () => number,
): EditResult & { id?: string } {
  const id = newId(board, random);
  const edges = list(board, "edges");
  const after = spec.afterId === undefined ? -1 : edges.findIndex((e) => e.id === spec.afterId);
  const anchor = after >= 0 ? edges[after] : undefined;
  const edge: Item = { id, kind: "message", from: spec.from, to: spec.to, manual: true };
  const label = spec.label.trim();
  if (label) edge.label = label;
  if (spec.messageType && spec.messageType !== "sync") edge.messageType = spec.messageType;
  const operand = anchor === undefined ? undefined : str(anchor.operandId);
  if (operand !== undefined) edge.operandId = operand;
  const at = after >= 0 ? after + 1 : edges.length;
  const result = checked({ ...board, edges: [...edges.slice(0, at), edge, ...edges.slice(at)] });
  return result.ok ? { ...result, id } : result;
}

/** Removes a message, tidies the fragments, and drops the sources nothing cites any more. */
export function removeMessage(board: RawBoard, edgeId: string): EditResult {
  const goneSources = new Set(
    orphanedSources(board, (item) => item.id === edgeId && "from" in item),
  );
  const next: RawBoard = { ...board, edges: list(board, "edges").filter((e) => e.id !== edgeId) };
  if (Array.isArray(board.sources)) {
    next.sources = (board.sources as Item[]).filter((s) => !goneSources.has(String(s.id)));
  }
  return checked(pruneFragments(next));
}

/** What moving a message one step would do: swap it, or take it out of or into a fragment. */
export type MessageMove =
  | { kind: "swap"; with: string }
  | { kind: "leave"; operandId: string; to: string | undefined }
  | { kind: "enter"; operandId: string };

/**
 * Where a message goes one step up (-1) or down (+1). Within an operand it swaps with the next
 * message there. At the edge of its operand it leaves it: into the operand before or after it
 * in the same fragment, or out of the fragment into the operand around it. Next to a fragment
 * it enters it, as that fragment's last message (going up) or first (going down). Null when
 * there is nowhere to go.
 */
export function messageMove(board: RawBoard, edgeId: string, step: -1 | 1): MessageMove | null {
  const order = messages(board);
  const k = order.findIndex(({ edge }) => edge.id === edgeId);
  if (k < 0) return null;
  const self = order[k]?.edge as Item;
  const near = order[k + step]?.edge;
  const mine = chainOf(board, self);
  const theirs = chainOf(board, near);
  let p = 0;
  while (p < mine.length && p < theirs.length && mine[p] === theirs[p]) p += 1;
  if (near !== undefined && mine.length === p && theirs.length === p) {
    return { kind: "swap", with: String(near.id) };
  }
  if (mine.length > p) {
    // At the edge of its innermost operand: leave it one level.
    const innermost = mine[mine.length - 1] as string;
    const owner = ownerOf(board, innermost);
    if (!owner) return null;
    const sibling = owner.fragment.operands[owner.index + step];
    return {
      kind: "leave",
      operandId: innermost,
      to: sibling !== undefined ? sibling.id : owner.fragment.parentOperandId,
    };
  }
  if (near !== undefined && theirs.length > p) {
    return { kind: "enter", operandId: theirs[p] as string };
  }
  return null;
}

/** Moves a message one step up or down (see `messageMove`); the message becomes manual. */
export function moveMessage(board: RawBoard, edgeId: string, step: -1 | 1): EditResult {
  const move = messageMove(board, edgeId, step);
  if (move === null)
    return refuse(step < 0 ? "already the first message" : "already the last message");
  const edges = list(board, "edges");
  const at = edges.findIndex((e) => e.id === edgeId);
  const out = [...edges];
  const self = edges[at] as Item;
  if (move.kind === "swap") {
    const other = edges.findIndex((e) => e.id === move.with);
    out[at] = edges[other] as Item;
    out[other] = asManual(self);
    return finish(board, out);
  }
  out[at] = asManual(withOperand(self, move.kind === "leave" ? move.to : move.operandId));
  return finish(board, out);
}

// ---------------------------------------------------------------------------------------------
// Fragments

/**
 * Wraps messages that follow each other in a new fragment of kind `kind`, inside the operand
 * they share. A fragment inside that operand moves in with them when all its messages do. An
 * `alt` or a `par` takes two operands: the last message goes in the second.
 */
export function wrapMessages(
  board: RawBoard,
  edgeIds: readonly string[],
  kind: FragmentKind,
  guard: string,
  random?: () => number,
): EditResult & { id?: string } {
  const order = messages(board);
  const picked = order
    .map(({ edge }, k) => ({ id: String(edge.id), k }))
    .filter(({ id }) => edgeIds.includes(id));
  if (picked.length === 0) return refuse("select the messages to wrap");
  const first = (picked[0] as { k: number }).k;
  const last = (picked[picked.length - 1] as { k: number }).k;
  if (last - first + 1 !== picked.length)
    return refuse("the messages to wrap must follow each other");
  const two = FRAGMENT_OPERANDS[kind].min === 2;
  if (two && picked.length < 2) return refuse(`${kind} needs two messages or more, one per branch`);

  // The operand they share: the longest common start of their chains.
  const chains = picked.map(({ k }) => chainOf(board, order[k]?.edge));
  let shared = 0;
  const base = chains[0] as string[];
  while (shared < base.length && chains.every((c) => c[shared] === base[shared])) shared += 1;
  const parent = shared > 0 ? base[shared - 1] : undefined;

  const fragmentId = newId(board, random);
  const withFragment = { ...board, fragments: [...list(board, "fragments"), { id: fragmentId }] };
  const operandId = newId(withFragment, random);
  const withOperandId = {
    ...withFragment,
    fragments: [...list(board, "fragments"), { id: fragmentId, operands: [{ id: operandId }] }],
  };
  const secondId = two ? newId(withOperandId, random) : undefined;

  const lastId = (picked[picked.length - 1] as { id: string }).id;
  const operandFor = (id: string) => (two && id === lastId ? (secondId as string) : operandId);
  const ids = new Set(picked.map((m) => m.id));
  const edges = list(board, "edges").map((edge) =>
    ids.has(String(edge.id)) && str(edge.operandId) === parent
      ? withOperand(edge, operandFor(String(edge.id)))
      : edge,
  );
  // A fragment in the shared operand whose messages all move goes with them.
  const runs = new Map<string, string[]>();
  for (const { edge } of order) {
    for (const op of chainOf(board, edge)) runs.set(op, [...(runs.get(op) ?? []), String(edge.id)]);
  }
  const fragments = list(board, "fragments").map((f) => {
    if (str(f.parentOperandId) !== parent) return f;
    const inside = (Array.isArray(f.operands) ? (f.operands as Item[]) : []).flatMap(
      (o) => runs.get(String(o.id)) ?? [],
    );
    if (inside.length === 0 || !inside.every((id) => ids.has(id))) return f;
    const target = two && inside.includes(lastId) ? (secondId as string) : operandId;
    return { ...f, parentOperandId: target };
  });
  const operands: Item[] = [{ id: operandId }];
  const condition = guard.trim();
  if (condition) (operands[0] as Item).guard = condition;
  if (secondId) operands.push({ id: secondId });
  const fragment: Item = { id: fragmentId, kind, operands, manual: true };
  if (parent !== undefined) fragment.parentOperandId = parent;
  const result = finish(board, edges, [...fragments, fragment]);
  if (!result.ok) return result;
  // Nothing moved in: the messages cross the edge of a fragment, so no frame can hold them.
  if (!list(result.board, "fragments").some((f) => f.id === fragmentId)) {
    return refuse(
      "these messages cross the edge of a fragment; select messages inside one operand",
    );
  }
  return { ...result, id: fragmentId };
}

/**
 * Splits the operand a message is in, at that message: it and the messages after it in the
 * operand (with their fragments) start a new operand. Only an `alt` or a `par` has several.
 */
export function splitOperand(
  board: RawBoard,
  edgeId: string,
  random?: () => number,
): EditResult & { id?: string } {
  const order = messages(board);
  const k = order.findIndex(({ edge }) => edge.id === edgeId);
  const self = order[k]?.edge;
  const operandId = self === undefined ? undefined : str(self.operandId);
  if (self === undefined || operandId === undefined) return refuse("the message is in no fragment");
  const owner = ownerOf(board, operandId);
  if (!owner) return refuse("the message is in no fragment");
  if (FRAGMENT_OPERANDS[owner.fragment.kind as FragmentKind]?.max === 1) {
    return refuse(`a ${owner.fragment.kind} has one operand; change it to alt or par first`);
  }
  const newOperand = newId(board, random);
  // Everything of the operand from this message on: its messages and its fragments.
  const later = new Set(order.slice(k).map(({ edge }) => String(edge.id)));
  const edges = list(board, "edges").map((edge) =>
    later.has(String(edge.id)) && edge.operandId === operandId
      ? withOperand(edge, newOperand)
      : edge,
  );
  const firstOf = new Map<string, number>();
  order.forEach(({ edge }, i) => {
    for (const op of chainOf(board, edge)) if (!firstOf.has(op)) firstOf.set(op, i);
  });
  const fragments = list(board, "fragments").map((f) => {
    if (f.id === owner.fragment.id) {
      const operands = [...(f.operands as Item[])];
      operands.splice(owner.index + 1, 0, { id: newOperand });
      return { ...f, operands, manual: true };
    }
    if (f.parentOperandId !== operandId) return f;
    const start = Math.min(
      ...(f.operands as Item[]).map((o) => firstOf.get(String(o.id)) ?? Number.POSITIVE_INFINITY),
    );
    return start >= k ? { ...f, parentOperandId: newOperand } : f;
  });
  const result = finish(board, edges, fragments);
  return result.ok ? { ...result, id: newOperand } : result;
}

/**
 * Changes a fragment's kind: `alt` and `par` keep their operands; `opt`, `loop` and `break`
 * take a fragment of one operand only. The fragment becomes manual.
 */
export function setFragmentKind(
  board: RawBoard,
  fragmentId: string,
  kind: FragmentKind,
): EditResult {
  const fragments = list(board, "fragments");
  const at = fragments.findIndex((f) => f.id === fragmentId);
  const fragment = fragments[at];
  if (!fragment) return refuse(`no fragment \`${fragmentId}\``);
  if (fragment.kind === kind) return { ok: true, board };
  const count = Array.isArray(fragment.operands) ? fragment.operands.length : 0;
  const bounds = FRAGMENT_OPERANDS[kind];
  if (count < bounds.min || count > bounds.max) {
    return refuse(
      bounds.max === 1
        ? `a ${kind} has one operand and this ${String(fragment.kind)} has ${count}; unwrap it or merge its branches first`
        : `a ${kind} needs ${bounds.min} operands or more; split the operand first`,
    );
  }
  const out = [...fragments];
  out[at] = { ...fragment, kind, manual: true };
  return checked({ ...board, fragments: out });
}

/** Changes an operand's guard; an empty one is removed. The operand becomes manual. */
export function setOperandGuard(board: RawBoard, operandId: string, value: string): EditResult {
  const fragments = list(board, "fragments");
  const at = fragments.findIndex(
    (f) => Array.isArray(f.operands) && (f.operands as Item[]).some((o) => o.id === operandId),
  );
  const fragment = fragments[at];
  if (!fragment) return refuse(`no operand \`${operandId}\``);
  const operands = [...(fragment.operands as Item[])];
  const index = operands.findIndex((o) => o.id === operandId);
  const operand = operands[index] as Item;
  const text = value.trim();
  if ((operand.guard ?? "") === text) return { ok: true, board };
  const next = asManual(operand);
  if (text === "") delete next.guard;
  else next.guard = text;
  operands[index] = next;
  const out = [...fragments];
  out[at] = { ...fragment, operands };
  return checked({ ...board, fragments: out });
}

/** Removes a fragment: its messages and its fragments move to the operand around it. */
export function unwrapFragment(board: RawBoard, fragmentId: string): EditResult {
  const fragments = list(board, "fragments");
  const fragment = fragments.find((f) => f.id === fragmentId);
  if (!fragment) return refuse(`no fragment \`${fragmentId}\``);
  const gone = new Set(((fragment.operands ?? []) as Item[]).map((o) => String(o.id)));
  const parent = str(fragment.parentOperandId);
  // The sources only its guards cited go with it.
  const goneSources = new Set(
    ((fragment.operands ?? []) as Item[])
      .flatMap((o) => [
        ...(Array.isArray(o.sourceIds) ? (o.sourceIds as string[]) : []),
        ...(Array.isArray(o.priorSourceIds) ? (o.priorSourceIds as string[]) : []),
      ])
      .filter((id) => !citedElsewhere(board, id, gone)),
  );
  const edges = list(board, "edges").map((e) =>
    typeof e.operandId === "string" && gone.has(e.operandId) ? withOperand(e, parent) : e,
  );
  const rest = fragments
    .filter((f) => f !== fragment)
    .map((f) => {
      if (typeof f.parentOperandId !== "string" || !gone.has(f.parentOperandId)) return f;
      const out = { ...f };
      if (parent === undefined) delete out.parentOperandId;
      else out.parentOperandId = parent;
      return out;
    });
  const next: RawBoard = { ...board, edges };
  if (rest.length > 0) next.fragments = rest;
  else delete next.fragments;
  if (Array.isArray(board.sources)) {
    next.sources = (board.sources as Item[]).filter((s) => !goneSources.has(String(s.id)));
  }
  return checked(next);
}

/** Whether anything but the given operands cites a source. */
function citedElsewhere(board: RawBoard, sourceId: string, except: ReadonlySet<string>): boolean {
  const cites = (item: Item) =>
    [item.sourceIds, item.priorSourceIds].some(
      (ids) => Array.isArray(ids) && (ids as unknown[]).includes(sourceId),
    );
  const nested = (item: Item) =>
    [item.guards, item.columns].some(
      (parts) => Array.isArray(parts) && (parts as Item[]).some(cites),
    ) ||
    (typeof item.handler === "object" && item.handler !== null && cites(item.handler as Item));
  if ([...list(board, "nodes"), ...list(board, "edges")].some((i) => cites(i) || nested(i))) {
    return true;
  }
  return list(board, "fragments").some((f) =>
    ((f.operands ?? []) as Item[]).some((o) => !except.has(String(o.id)) && cites(o)),
  );
}
