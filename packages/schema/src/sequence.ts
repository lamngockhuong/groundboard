import type { Board, BoardEdge, BoardFragment, BoardNode, FragmentKind } from "./board.ts";
import { LIMITS } from "./limits.ts";
import { parseRef, type RefNamespace } from "./ref.ts";

/** The namespaces a message's `ref` may name besides a screen: an endpoint, a table, a job. */
const MESSAGE_REF_NAMESPACES: readonly RefNamespace[] = ["api", "db", "batch"];

/**
 * Sequence boards: a board that holds `participant` nodes is a sequence diagram. Its messages
 * are the `message` edges in the order of `edges`, its columns the participants in the order of
 * `nodes`, and its combined fragments (`fragments`) frame runs of messages. Validation, layout,
 * the renderer and the viewer's edit mode read these helpers instead of walking fragments
 * themselves.
 */

/** Node kinds a sequence board may hold besides its participants. */
export const SEQUENCE_NODE_KINDS = ["participant", "question", "note"] as const;

/** How many operands each fragment kind takes: at least, and at most (`Infinity` for no bound). */
export const FRAGMENT_OPERANDS: Record<FragmentKind, { min: number; max: number }> = {
  alt: { min: 2, max: LIMITS.operandsPerFragment },
  par: { min: 2, max: LIMITS.operandsPerFragment },
  opt: { min: 1, max: 1 },
  loop: { min: 1, max: 1 },
  break: { min: 1, max: 1 },
};

/** Whether a board is a sequence diagram: it holds a participant. */
export function isSequenceBoard(board: Pick<Board, "nodes">): boolean {
  return board.nodes.some((n) => n.kind === "participant");
}

/** The messages of a board in the order they are sent: the order of `edges`. */
export function messageOrder<E extends Pick<BoardEdge, "kind">>(edges: readonly E[]): E[] {
  return edges.filter((e) => e.kind === "message");
}

interface FragmentLike {
  id: string;
  kind?: string;
  parentOperandId?: string | undefined;
  operands: ReadonlyArray<{ id: string }>;
}

interface MessageLike {
  id: string;
  kind?: string;
  operandId?: string | undefined;
}

/** Where each operand is: its fragment's index and its own index among the fragment's operands. */
export function operandIndex(
  fragments: readonly FragmentLike[],
): Map<string, { fragment: number; operand: number }> {
  const out = new Map<string, { fragment: number; operand: number }>();
  fragments.forEach((fragment, f) => {
    fragment.operands.forEach((operand, o) => {
      if (!out.has(operand.id)) out.set(operand.id, { fragment: f, operand: o });
    });
  });
  return out;
}

/**
 * The operands that contain an operand, nearest first, starting with the operand itself: its
 * fragment's parent operand, that one's fragment's parent, and so on. Stops at a cycle, at an
 * unknown operand and past `LIMITS.fragmentDepth + 1` levels.
 */
export function operandChain(operandId: string, fragments: readonly FragmentLike[]): string[] {
  const where = operandIndex(fragments);
  const chain: string[] = [];
  let current: string | undefined = operandId;
  while (current !== undefined && !chain.includes(current) && where.has(current)) {
    chain.push(current);
    if (chain.length > LIMITS.fragmentDepth + 1) break;
    const at = where.get(current) as { fragment: number };
    current = fragments[at.fragment]?.parentOperandId;
  }
  return chain;
}

/**
 * The positions, in message order, of the messages of each operand, its fragments' included,
 * ascending. An operand with no message has an empty list.
 */
export function operandRuns(
  edges: readonly MessageLike[],
  fragments: readonly FragmentLike[],
): Map<string, number[]> {
  const runs = new Map<string, number[]>();
  for (const fragment of fragments)
    for (const operand of fragment.operands) runs.set(operand.id, []);
  messageOrder(edges as Array<MessageLike & { kind: BoardEdge["kind"] }>).forEach((message, k) => {
    if (message.operandId === undefined) return;
    for (const operandId of operandChain(message.operandId, fragments))
      runs.get(operandId)?.push(k);
  });
  return runs;
}

/** How deep each fragment sits: 1 for one at the top level. A cycle counts as too deep. */
export function fragmentDepths(fragments: readonly FragmentLike[]): Map<string, number> {
  const where = operandIndex(fragments);
  const depths = new Map<string, number>();
  fragments.forEach((fragment) => {
    let depth = 1;
    const seen = new Set([fragment.id]);
    let parent = fragment.parentOperandId;
    while (parent !== undefined && where.has(parent)) {
      const owner = fragments[(where.get(parent) as { fragment: number }).fragment] as FragmentLike;
      if (seen.has(owner.id)) {
        depth = Number.POSITIVE_INFINITY;
        break;
      }
      seen.add(owner.id);
      depth += 1;
      parent = owner.parentOperandId;
    }
    if (!depths.has(fragment.id)) depths.set(fragment.id, depth);
  });
  return depths;
}

type Add = (path: ReadonlyArray<PropertyKey>, message: string) => void;

export interface SequenceCheck {
  board: Board;
  add: Add;
  /** Whether one of the sources can back a behaviour (`isBehaviourSource`). */
  backsBehaviour: (sourceIds: string[]) => boolean;
  /** Whether a source id names a source of the board. */
  hasSource: (sourceId: string) => boolean;
  /** Reports prior sources of an item that is not manual, and ones that name no source. */
  checkPriorSources: (
    item: { id: string; manual?: true; priorSourceIds?: string[] },
    at: Array<string | number>,
  ) => void;
}

/** What may back a participant, a message or a guard, for messages. */
const BEHAVIOUR_SOURCES =
  "a quoted code source, a doc source, a figma source, a mockup with a path, or a link with a quote";

/**
 * The rules of a sequence board: what it may hold, its participants and messages, and its
 * fragments, which nest, take the operands their kind allows, and frame runs of messages that
 * follow each other. A board without participants may hold neither messages nor fragments.
 */
export function checkSequence({
  board,
  add,
  backsBehaviour,
  hasSource,
  checkPriorSources,
}: SequenceCheck): void {
  const fragments = board.fragments ?? [];
  const sequence = isSequenceBoard(board);
  const byId = new Map<string, BoardNode>();
  for (const node of board.nodes) if (!byId.has(node.id)) byId.set(node.id, node);

  if (!sequence) {
    board.edges.forEach((edge, i) => {
      if (edge.kind === "message") {
        add(
          ["edges", i, "kind"],
          `message edge \`${edge.id}\` is on a board without participants; a message goes between participants of a sequence board`,
        );
      }
    });
    if (fragments.length > 0) {
      add(
        ["fragments"],
        "fragments belong to a sequence board; this board has no participant node",
      );
    }
    return;
  }

  // What a sequence board may hold.
  board.nodes.forEach((node, i) => {
    if (!(SEQUENCE_NODE_KINDS as readonly string[]).includes(node.kind)) {
      add(
        ["nodes", i, "kind"],
        `\`${node.kind}\` node \`${node.id}\` is on a sequence board, which holds only participant, question and note nodes; draw it on a flow board`,
      );
    }
  });
  board.edges.forEach((edge, i) => {
    if (edge.kind !== "message") {
      add(
        ["edges", i, "kind"],
        `\`${edge.kind}\` edge \`${edge.id}\` is on a sequence board, which holds only message edges`,
      );
    }
  });
  if (board.groups.length > 0) {
    add(["groups"], "a sequence board has no groups; frame its messages with fragments instead");
  }

  // Participants: a category, and a source for anything but a person.
  board.nodes.forEach((node, i) => {
    if (node.kind !== "participant") return;
    if (node.category === undefined) {
      add(
        ["nodes", i, "category"],
        `participant \`${node.id}\` needs a category: person, system, external, database or queue`,
      );
      return;
    }
    if (node.category !== "person" && !node.manual && !backsBehaviour(node.sourceIds)) {
      add(
        ["nodes", i, "sourceIds"],
        `participant \`${node.id}\` (${node.category}) cites no source that can back it; cite the line that creates its client, imports its SDK or opens the connection, or ${BEHAVIOUR_SOURCES}`,
      );
    }
  });

  // Ids of fragments and operands share the board's space with nodes and edges.
  const taken = new Set<string>([...board.nodes.map((n) => n.id), ...board.edges.map((e) => e.id)]);
  fragments.forEach((fragment, f) => {
    if (taken.has(fragment.id)) {
      add(["fragments", f, "id"], `fragment id \`${fragment.id}\` is already used on this board`);
    }
    taken.add(fragment.id);
    fragment.operands.forEach((operand, o) => {
      if (taken.has(operand.id)) {
        add(
          ["fragments", f, "operands", o, "id"],
          `operand id \`${operand.id}\` is already used on this board`,
        );
      }
      taken.add(operand.id);
    });
  });

  const where = operandIndex(fragments);
  const nameOf = (operandId: string) => {
    const at = where.get(operandId);
    const fragment = at === undefined ? undefined : fragments[at.fragment];
    return fragment === undefined
      ? `\`${operandId}\``
      : `\`${operandId}\` of ${fragment.kind} \`${fragment.id}\``;
  };

  // Messages: between participants, cited, in a known operand.
  board.edges.forEach((edge, i) => {
    if (edge.kind !== "message") return;
    for (const end of ["from", "to"] as const) {
      const nodeId = edge[end];
      const node = nodeId === undefined ? undefined : byId.get(nodeId);
      if (node !== undefined && node.kind !== "participant") {
        add(
          ["edges", i, end],
          `message \`${edge.id}\` ${end === "from" ? "starts" : "ends"} at \`${node.kind}\` node \`${node.id}\`; a message goes between participants`,
        );
      }
    }
    if (edge.ref !== undefined) {
      // What a message reaches: an endpoint, a table (or a column) or a job, or a whole screen;
      // never an element of a screen.
      const parsed = parseRef(edge.ref);
      if (parsed !== null && "platform" in parsed && parsed.element !== undefined) {
        add(
          ["edges", i, "ref"],
          `message \`${edge.id}\` ref \`${edge.ref}\` names an element; a message reaches an endpoint, a table, a job or a screen`,
        );
      } else if (
        parsed !== null &&
        !("platform" in parsed) &&
        !MESSAGE_REF_NAMESPACES.includes(parsed.namespace)
      ) {
        add(
          ["edges", i, "ref"],
          `message \`${edge.id}\` ref \`${edge.ref}\` is in namespace ${parsed.namespace}; a message reaches an api, db or batch ref, or a screen`,
        );
      }
    }
    if (edge.operandId !== undefined && !where.has(edge.operandId)) {
      add(
        ["edges", i, "operandId"],
        `message \`${edge.id}\` has operandId \`${edge.operandId}\`, which is not an operand of a fragment`,
      );
    }
    if (!edge.manual && !backsBehaviour(edge.sourceIds)) {
      add(
        ["edges", i, "sourceIds"],
        `message \`${edge.id}\` cites no source that can back it; cite the line that makes the call${edge.messageType === "reply" ? " (for a reply: the line that returns or receives the result)" : ""}, or ${BEHAVIOUR_SOURCES}`,
      );
    }
  });

  // Fragments: operand counts, parents, depth, guards and their sources.
  const depths = fragmentDepths(fragments);
  fragments.forEach((fragment, f) => {
    const bounds = FRAGMENT_OPERANDS[fragment.kind];
    const count = fragment.operands.length;
    if (count < bounds.min || count > bounds.max) {
      add(
        ["fragments", f, "operands"],
        bounds.max === 1
          ? `${fragment.kind} fragment \`${fragment.id}\` has ${count} operands; ${fragment.kind} has exactly one`
          : `${fragment.kind} fragment \`${fragment.id}\` has ${count} operand(s); ${fragment.kind} has at least ${bounds.min}`,
      );
    }
    if (fragment.parentOperandId !== undefined) {
      const parent = where.get(fragment.parentOperandId);
      if (parent === undefined) {
        add(
          ["fragments", f, "parentOperandId"],
          `fragment \`${fragment.id}\` has parentOperandId \`${fragment.parentOperandId}\`, which is not an operand of a fragment`,
        );
      } else if (parent.fragment === f) {
        add(
          ["fragments", f, "parentOperandId"],
          `fragment \`${fragment.id}\` cannot sit in its own operand \`${fragment.parentOperandId}\``,
        );
      }
    }
    const depth = depths.get(fragment.id) ?? 1;
    if (depth === Number.POSITIVE_INFINITY) {
      add(
        ["fragments", f, "parentOperandId"],
        `fragment \`${fragment.id}\` sits, through its parents, inside itself`,
      );
    } else if (depth > LIMITS.fragmentDepth) {
      add(
        ["fragments", f, "parentOperandId"],
        `fragment \`${fragment.id}\` is nested ${depth} levels deep; at most ${LIMITS.fragmentDepth} levels are allowed`,
      );
    }
    fragment.operands.forEach((operand, o) => {
      const at: Array<string | number> = ["fragments", f, "operands", o];
      operand.sourceIds.forEach((sourceId, k) => {
        if (!hasSource(sourceId)) {
          add(
            [...at, "sourceIds", k],
            `operand \`${operand.id}\` cites source \`${sourceId}\`, which is not a source id`,
          );
        }
      });
      checkPriorSources(operand, at);
      if (
        operand.guard !== undefined &&
        !operand.manual &&
        !fragment.manual &&
        !backsBehaviour(operand.sourceIds)
      ) {
        add(
          [...at, "sourceIds"],
          `the guard [${operand.guard.slice(0, 60)}] of operand ${nameOf(operand.id)} cites no source that can back it; cite the line of the condition (an if, a for, a catch), or ${BEHAVIOUR_SOURCES}`,
        );
      }
    });
  });

  checkRuns(board.edges, fragments, add);
}

/**
 * Every operand holds at least one message, its messages (its fragments' included) follow each
 * other in message order, and the operands of a fragment follow each other in their order.
 */
function checkRuns(
  edges: readonly BoardEdge[],
  fragments: readonly BoardFragment[],
  add: Add,
): void {
  const messages = messageOrder(edges);
  const pathOf = new Map<string, number>();
  edges.forEach((edge, i) => {
    if (!pathOf.has(edge.id)) pathOf.set(edge.id, i);
  });
  const runs = operandRuns(edges, fragments);
  fragments.forEach((fragment, f) => {
    let previous: { id: string; last: number } | undefined;
    fragment.operands.forEach((operand, o) => {
      const run = runs.get(operand.id) ?? [];
      if (run.length === 0) {
        add(
          ["fragments", f, "operands", o],
          `operand \`${operand.id}\` of ${fragment.kind} \`${fragment.id}\` has no message; give a message operandId \`${operand.id}\`, or remove the operand`,
        );
        previous = undefined;
        return;
      }
      const first = run[0] as number;
      const last = run[run.length - 1] as number;
      if (last - first + 1 !== run.length) {
        const inside = new Set(run);
        let gap = first;
        while (inside.has(gap)) gap += 1;
        const intruder = messages[gap] as BoardEdge;
        add(
          ["edges", pathOf.get(intruder.id) as number],
          `message \`${intruder.id}\` sits between messages of operand \`${operand.id}\` of ${fragment.kind} \`${fragment.id}\` but is not in it; move it out of the run, or give it operandId \`${operand.id}\``,
        );
      } else if (previous !== undefined && first !== previous.last + 1) {
        const moved = messages[first] as BoardEdge;
        add(
          ["edges", pathOf.get(moved.id) as number],
          `the operands of ${fragment.kind} \`${fragment.id}\` do not follow each other: operand \`${operand.id}\` starts at message \`${moved.id}\`, not right after operand \`${previous.id}\`; move message \`${moved.id}\` next to the other messages of the fragment`,
        );
      }
      previous = { id: operand.id, last };
    });
  });
}

type Raw = Record<string, unknown>;

/** A fragment `pruneFragments` removed: its id and kind, and its operands left with no message. */
export interface RemovedFragment {
  id: string;
  kind: string;
  /** The operands that held no message any more, with their guards, in their order. */
  emptied: Array<{ id: string; guard?: string }>;
}

export interface PruneResult<B> {
  board: B;
  /** Fragments removed, in the order they went. */
  removed: RemovedFragment[];
  /** Messages a removed fragment held directly, moved out to the operand around it. */
  lifted: string[];
}

/**
 * Tidies the fragments of a sequence board after messages were removed or moved, on its raw
 * JSON: an operand left with no message is dropped; a fragment left with fewer operands than
 * its kind takes is removed, its messages and its fragments moved to the operand it sat in (or
 * to the top level). Repeated until nothing changes. Every other field is kept as written.
 * Returns the board (the same object when nothing changed), the fragments removed and the
 * messages they held.
 */
export function pruneFragments<B extends Raw>(board: B): PruneResult<B> {
  let edges = (Array.isArray(board.edges) ? board.edges : []) as Raw[];
  let fragments = (Array.isArray(board.fragments) ? board.fragments : []) as Raw[];
  const removed: RemovedFragment[] = [];
  const lifted = new Set<string>();
  if (fragments.length === 0) return { board, removed, lifted: [] };
  let changed = false;
  const operandsOf = (fragment: Raw) =>
    (Array.isArray(fragment.operands) ? fragment.operands : []) as Raw[];
  for (;;) {
    const runs = operandRuns(
      edges as unknown as MessageLike[],
      fragments.map((f) => ({
        id: String(f.id),
        parentOperandId: typeof f.parentOperandId === "string" ? f.parentOperandId : undefined,
        operands: operandsOf(f).map((op) => ({ id: String(op.id) })),
      })),
    );
    const holds = (op: Raw) => (runs.get(String(op.id))?.length ?? 0) > 0;
    // A fragment left with too few operands that hold a message goes first, whole.
    const gone = fragments.find(
      (f) =>
        operandsOf(f).filter(holds).length < (FRAGMENT_OPERANDS[f.kind as FragmentKind]?.min ?? 1),
    );
    if (gone !== undefined) {
      changed = true;
      removed.push({
        id: String(gone.id),
        kind: String(gone.kind),
        emptied: operandsOf(gone)
          .filter((op) => !holds(op))
          .map((op) => ({
            id: String(op.id),
            ...(typeof op.guard === "string" ? { guard: op.guard } : {}),
          })),
      });
      const ids = new Set(operandsOf(gone).map((op) => String(op.id)));
      const parent = typeof gone.parentOperandId === "string" ? gone.parentOperandId : undefined;
      const lift = (item: Raw, key: "operandId" | "parentOperandId"): Raw => {
        if (typeof item[key] !== "string" || !ids.has(item[key] as string)) return item;
        if (key === "operandId") lifted.add(String(item.id));
        const out = { ...item };
        if (parent === undefined) delete out[key];
        else out[key] = parent;
        return out;
      };
      edges = edges.map((e) => lift(e, "operandId"));
      fragments = fragments.filter((f) => f !== gone).map((f) => lift(f, "parentOperandId"));
      continue;
    }
    // Then the operands that hold no message.
    const emptied = fragments.some((f) => !operandsOf(f).every(holds));
    if (!emptied) break;
    changed = true;
    fragments = fragments.map((f) =>
      operandsOf(f).every(holds) ? f : { ...f, operands: operandsOf(f).filter(holds) },
    );
  }
  if (!changed) return { board, removed, lifted: [] };
  const out: Raw = { ...board, edges };
  if (fragments.length > 0) out.fragments = fragments;
  else delete out.fragments;
  return { board: out as B, removed, lifted: [...lifted] };
}
