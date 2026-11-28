import { describe, expect, test } from "vitest";
import { hasFlow, type RefUse, refsOf } from "./atlas-shape.ts";
import { boardClaims } from "./grounding.ts";
import { lintBoardText } from "./lint-text.ts";
import { isSequenceBoard, messageOrder, operandRuns, pruneFragments } from "./sequence.ts";
import { parseBoard } from "./validate.ts";

const code = (id: string, line: number, quote: string) => ({
  id,
  path: "server/orders-routes.ts",
  line,
  quote,
});

/** The handler of POST /api/orders as a sequence: an alt of authorized and declined, a loop inside. */
function sequence() {
  return {
    schemaVersion: 1,
    title: "Placing an order",
    question: "What does POST /api/orders do?",
    nodes: [
      { id: "user", kind: "participant", category: "person", label: "Customer" },
      {
        id: "api",
        kind: "participant",
        category: "system",
        label: "Orders API",
        ref: "api:orders/post",
        sourceIds: ["route"],
      },
      {
        id: "bank",
        kind: "participant",
        category: "external",
        label: "Payment gateway",
        sourceIds: ["gw"],
      },
      { id: "db", kind: "participant", category: "database", label: "Database", sourceIds: ["db"] },
      {
        id: "q",
        kind: "participant",
        category: "queue",
        label: "Job queue",
        ref: "batch:send-receipt",
        sourceIds: ["queue"],
      },
    ] as Array<Record<string, unknown>>,
    edges: [
      {
        id: "m1",
        kind: "message",
        from: "user",
        to: "api",
        label: "POST /api/orders",
        ref: "api:orders/post",
        sourceIds: ["route"],
      },
      {
        id: "m2",
        kind: "message",
        from: "api",
        to: "bank",
        label: "authorize(amount)",
        sourceIds: ["auth"],
      },
      {
        id: "m3",
        kind: "message",
        messageType: "reply",
        from: "bank",
        to: "api",
        label: "authorization id",
        sourceIds: ["auth"],
      },
      {
        id: "m4",
        kind: "message",
        from: "api",
        to: "db",
        label: "insert order",
        ref: "db:orders",
        operandId: "ok",
        sourceIds: ["insert"],
      },
      {
        id: "m5",
        kind: "message",
        from: "api",
        to: "db",
        label: "insert line",
        ref: "db:order-items",
        operandId: "each",
        sourceIds: ["line"],
      },
      {
        id: "m6",
        kind: "message",
        messageType: "async",
        from: "api",
        to: "q",
        label: "send-receipt",
        operandId: "ok",
        sourceIds: ["enqueue"],
      },
      {
        id: "m7",
        kind: "message",
        messageType: "reply",
        from: "api",
        to: "user",
        label: "402 declined",
        operandId: "declined",
        sourceIds: ["decline"],
      },
    ] as Array<Record<string, unknown>>,
    fragments: [
      {
        id: "pay",
        kind: "alt",
        operands: [
          { id: "ok", guard: "authorized", sourceIds: ["if-ok"] },
          { id: "declined", guard: "declined", sourceIds: ["if-ok"] },
        ],
      },
      {
        id: "lines",
        kind: "loop",
        parentOperandId: "ok",
        operands: [{ id: "each", guard: "each cart line", sourceIds: ["for"] }],
      },
    ] as Array<Record<string, unknown>>,
    sources: [
      code("route", 8, 'router.post("/orders"'),
      code("gw", 3, "import { gateway }"),
      code("db", 4, "import { db }"),
      code("queue", 5, "import { queue }"),
      code("auth", 9, "await gateway.authorize"),
      code("if-ok", 10, "if (!authorized)"),
      code("insert", 11, 'db.insert("orders"'),
      code("for", 12, "for (const line of"),
      code("line", 13, 'db.insert("order_items"'),
      code("enqueue", 14, 'queue.add("send-receipt"'),
      code("decline", 15, "res.status(402)"),
    ],
  };
}

const messages = (input: unknown) => {
  const result = parseBoard(input);
  return result.ok ? [] : result.error.map((i) => `${i.path}: ${i.message}`);
};

describe("a sequence board", () => {
  test("the handler with an alt that holds a loop is valid, and reads as a sequence", () => {
    const result = parseBoard(sequence());
    expect(result.ok, JSON.stringify(result.ok ? null : result.error)).toBe(true);
    if (!result.ok) return;
    expect(isSequenceBoard(result.value)).toBe(true);
    expect(messageOrder(result.value.edges).map((e) => e.id)).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
      "m5",
      "m6",
      "m7",
    ]);
    const runs = operandRuns(result.value.edges, result.value.fragments ?? []);
    expect(Object.fromEntries(runs)).toEqual({ ok: [3, 4, 5], declined: [6], each: [4] });
    expect(lintBoardText(result.value)).toEqual([]);
  });

  test("participants other than a person, every message and every guard are claims", () => {
    const result = parseBoard(sequence());
    if (!result.ok) throw new Error("invalid");
    const claims = boardClaims(result.value);
    expect(claims.filter((c) => c.on === "node").map((c) => c.id)).toEqual([
      "api",
      "bank",
      "db",
      "q",
    ]);
    expect(claims.filter((c) => c.on === "edge")).toHaveLength(7);
    expect(claims.filter((c) => c.on === "operand")).toEqual([
      { path: "fragments[0].operands[0]", id: "ok", on: "operand", grounding: "code" },
      { path: "fragments[0].operands[1]", id: "declined", on: "operand", grounding: "code" },
      { path: "fragments[1].operands[0]", id: "each", on: "operand", grounding: "code" },
    ]);
  });

  test("a manual participant, message or fragment counts as none and needs no source", () => {
    const board = sequence();
    Object.assign(board.nodes[2] as object, { manual: true, sourceIds: [] });
    Object.assign(board.edges[1] as object, { manual: true, sourceIds: [] });
    Object.assign(board.fragments[1] as object, { manual: true });
    (
      (board.fragments[1] as { operands: Array<Record<string, unknown>> }).operands[0] as Record<
        string,
        unknown
      >
    ).sourceIds = [];
    const result = parseBoard(board);
    expect(result.ok, JSON.stringify(result.ok ? null : result.error)).toBe(true);
    if (!result.ok) return;
    const claims = boardClaims(result.value);
    for (const id of ["bank", "m2", "each"]) {
      expect(
        claims.find((c) => c.id === id),
        id,
      ).toMatchObject({ grounding: "none", manual: true });
    }
  });
});

describe("the rules of a sequence board", () => {
  test("a participant needs a category, and a source unless it is a person", () => {
    const board = sequence();
    delete (board.nodes[1] as Record<string, unknown>).category;
    expect(messages(board)).toContain(
      "nodes[1].category: participant `api` needs a category: person, system, external, database or queue",
    );
    const bare = sequence();
    (bare.nodes[2] as Record<string, unknown>).sourceIds = [];
    expect(messages(bare).join(" ")).toContain(
      "nodes[2].sourceIds: participant `bank` (external) cites no source that can back it",
    );
    const fields = sequence();
    (fields.nodes[1] as Record<string, unknown>).trigger = { type: "manual" };
    expect(messages(fields).join(" ")).toContain("trigger is only allowed on `job` nodes");
  });

  test("a sequence board holds only participants, questions, notes and messages, and no groups", () => {
    const board = sequence();
    board.nodes.push({ id: "s", kind: "step", label: "A step", sourceIds: ["route"] });
    board.edges.push({ id: "f", kind: "flow", from: "user", to: "api" });
    (board as Record<string, unknown>).groups = [{ id: "g", label: "G" }];
    const found = messages(board);
    expect(found).toContain(
      "nodes[5].kind: `step` node `s` is on a sequence board, which holds only participant, question and note nodes; draw it on a flow board",
    );
    expect(found).toContain(
      "edges[7].kind: `flow` edge `f` is on a sequence board, which holds only message edges",
    );
    expect(found).toContain(
      "groups: a sequence board has no groups; frame its messages with fragments instead",
    );
    const note = sequence();
    note.nodes.push({ id: "n", kind: "note", label: "Amounts are in cents" });
    note.nodes.push({ id: "ask", kind: "question", label: "Who retries a timeout? (Payments)" });
    expect(messages(note)).toEqual([]);
  });

  test("a board without participants holds neither messages nor fragments", () => {
    const flow = {
      schemaVersion: 1,
      title: "Flow",
      question: "Q?",
      nodes: [
        { id: "a", kind: "step", label: "A", sourceIds: ["s"] },
        { id: "b", kind: "step", label: "B", sourceIds: ["s"] },
      ],
      edges: [{ id: "m", kind: "message", from: "a", to: "b", sourceIds: ["s"] }],
      fragments: [{ id: "f", kind: "opt", operands: [{ id: "o" }] }],
      sources: [code("s", 1, "x")],
    };
    const found = messages(flow);
    expect(found).toContain(
      "edges[0].kind: message edge `m` is on a board without participants; a message goes between participants of a sequence board",
    );
    expect(found).toContain(
      "fragments: fragments belong to a sequence board; this board has no participant node",
    );
  });

  test("a message goes between participants, cites its call, and takes no toRef", () => {
    const board = sequence();
    board.nodes.push({ id: "n", kind: "note", label: "A note" });
    (board.edges[0] as Record<string, unknown>).to = "n";
    expect(messages(board)).toContain(
      "edges[0].to: message `m1` ends at `note` node `n`; a message goes between participants",
    );
    const uncited = sequence();
    (uncited.edges[2] as Record<string, unknown>).sourceIds = [];
    expect(messages(uncited).join(" ")).toContain(
      "message `m3` cites no source that can back it; cite the line that makes the call (for a reply: the line that returns or receives the result)",
    );
    const toRef = sequence();
    const edge = toRef.edges[0] as Record<string, unknown>;
    delete edge.to;
    edge.toRef = "api:orders/post";
    expect(messages(toRef).join(" ")).toContain("toRef is only allowed on");
    const self = sequence();
    (self.edges[1] as Record<string, unknown>).to = "api";
    expect(messages(self)).toEqual([]);
  });

  test("messageType, operandId and ref belong to messages, category to participants", () => {
    const board = {
      schemaVersion: 1,
      title: "Flow",
      question: "Q?",
      nodes: [
        { id: "a", kind: "step", label: "A", sourceIds: ["s"], category: "system" },
        { id: "b", kind: "step", label: "B", sourceIds: ["s"] },
      ],
      edges: [{ id: "e", kind: "flow", from: "a", to: "b", messageType: "async", ref: "db:x" }],
      sources: [code("s", 1, "x")],
    };
    const found = messages(board);
    expect(found).toContain(
      "nodes[0].category: category is only allowed on `participant` nodes, not on `step` node `a`",
    );
    expect(found).toContain(
      "edges[0].messageType: messageType is only allowed on message edges, not on `flow` edge `e`",
    );
    expect(found).toContain(
      "edges[0].ref: ref is only allowed on message edges, not on `flow` edge `e`",
    );
  });

  test("a message's operandId names an operand", () => {
    const board = sequence();
    (board.edges[3] as Record<string, unknown>).operandId = "nope";
    expect(messages(board)).toContain(
      "edges[3].operandId: message `m4` has operandId `nope`, which is not an operand of a fragment",
    );
  });

  test("alt and par take two operands or more, opt, loop and break exactly one", () => {
    const one = sequence();
    const pay = one.fragments[0] as { operands: unknown[] };
    pay.operands = pay.operands.slice(0, 1);
    (one.edges[6] as Record<string, unknown>).operandId = "ok";
    expect(messages(one)).toContain(
      "fragments[0].operands: alt fragment `pay` has 1 operand(s); alt has at least 2",
    );
    const two = sequence();
    (two.fragments[1] as { operands: unknown[] }).operands.push({ id: "again" });
    expect(messages(two).join(" ")).toContain(
      "loop fragment `lines` has 2 operands; loop has exactly one",
    );
  });

  test("ids of fragments and operands are unique among the board's ids", () => {
    const board = sequence();
    (
      (board.fragments[1] as { operands: Array<Record<string, unknown>> }).operands[0] as Record<
        string,
        unknown
      >
    ).id = "m1";
    (board.edges[4] as Record<string, unknown>).operandId = "m1";
    expect(messages(board)).toContain(
      "fragments[1].operands[0].id: operand id `m1` is already used on this board",
    );
    const twice = sequence();
    (twice.fragments[1] as Record<string, unknown>).id = "api";
    expect(messages(twice)).toContain(
      "fragments[1].id: fragment id `api` is already used on this board",
    );
  });

  test("fragments nest at most four deep and never inside themselves", () => {
    const board = sequence();
    board.edges[4] = { ...board.edges[4], operandId: "d4" };
    board.fragments.push(
      { id: "f2", kind: "opt", parentOperandId: "each", operands: [{ id: "d2" }] },
      { id: "f3", kind: "opt", parentOperandId: "d2", operands: [{ id: "d3" }] },
      { id: "f4", kind: "opt", parentOperandId: "d3", operands: [{ id: "d4" }] },
    );
    expect(messages(board)).toContain(
      "fragments[4].parentOperandId: fragment `f4` is nested 5 levels deep; at most 4 levels are allowed",
    );
    const loop = sequence();
    (loop.fragments[0] as Record<string, unknown>).parentOperandId = "each";
    expect(messages(loop).join(" ")).toContain("sits, through its parents, inside itself");
    const self = sequence();
    (self.fragments[1] as Record<string, unknown>).parentOperandId = "each";
    expect(messages(self).join(" ")).toContain(
      "fragment `lines` cannot sit in its own operand `each`",
    );
  });

  test("a message between the messages of an operand breaks its run", () => {
    const board = sequence();
    // m5 moves out of the loop and the alt, between m4 and m6 of operand ok.
    delete (board.edges[4] as Record<string, unknown>).operandId;
    expect(messages(board)).toContain(
      "edges[4]: message `m5` sits between messages of operand `ok` of alt `pay` but is not in it; move it out of the run, or give it operandId `ok`",
    );
  });

  test("the operands of a fragment follow each other, and a nested fragment stays in its operand", () => {
    const board = sequence();
    // m7 (declined) moves before m4: operand ok no longer comes right before declined.
    const [m7] = board.edges.splice(6, 1);
    board.edges.splice(3, 0, m7 as Record<string, unknown>);
    expect(messages(board).join(" ")).toContain(
      "the operands of alt `pay` do not follow each other: operand `declined` starts at message `m7`, not right after operand `ok`",
    );
    const outside = sequence();
    // The loop's message moves to the end, outside operand ok.
    const [m5] = outside.edges.splice(4, 1);
    outside.edges.push(m5 as Record<string, unknown>);
    expect(messages(outside).join(" ")).toContain(
      "message `m7` sits between messages of operand `ok` of alt `pay`",
    );
  });

  test("an operand with no message is refused", () => {
    const board = sequence();
    (board.fragments[0] as { operands: unknown[] }).operands.push({ id: "later" });
    expect(messages(board)).toContain(
      "fragments[0].operands[2]: operand `later` of alt `pay` has no message; give a message operandId `later`, or remove the operand",
    );
  });

  test("a guard cites its condition, unless its operand or its fragment is manual; par needs none", () => {
    const board = sequence();
    (
      (board.fragments[1] as { operands: Array<Record<string, unknown>> }).operands[0] as Record<
        string,
        unknown
      >
    ).sourceIds = [];
    expect(messages(board).join(" ")).toContain(
      "fragments[1].operands[0].sourceIds: the guard [each cart line] of operand `each` of loop `lines` cites no source that can back it",
    );
    const par = sequence();
    Object.assign(par.fragments[0] as object, {
      kind: "par",
      operands: [{ id: "ok" }, { id: "declined" }],
    });
    expect(messages(par)).toEqual([]);
    const missing = sequence();
    (
      (missing.fragments[1] as { operands: Array<Record<string, unknown>> }).operands[0] as Record<
        string,
        unknown
      >
    ).sourceIds = ["nope"];
    expect(messages(missing).join(" ")).toContain(
      "operand `each` cites source `nope`, which is not a source id",
    );
  });

  test("at most 100 fragments and 8 operands to a fragment", () => {
    const board = sequence();
    (board.fragments[0] as { operands: unknown[] }).operands = Array.from(
      { length: 9 },
      (_, i) => ({
        id: `o${i}`,
      }),
    );
    expect(messages(board).join(" ")).toContain("fragments[0].operands has more than 8 items");
  });

  test("a fragment label and an operand guard that look like an email are warnings", () => {
    const board = sequence();
    (board.fragments[0] as Record<string, unknown>).label = "ask ana@example.com";
    const result = parseBoard(board);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(lintBoardText(result.value).join(" ")).toContain("fragments[0].label");
  });
});

describe("refs on a sequence board", () => {
  test("a participant's ref is a node's use; a message's ref is an edge's", () => {
    const result = parseBoard(sequence());
    if (!result.ok) throw new Error("invalid");
    const { defined, used } = refsOf(result.value);
    expect(defined).toEqual([]);
    expect(used).toEqual([
      { ref: "api:orders/post", nodeId: "api" },
      { ref: "batch:send-receipt", nodeId: "q" },
      { ref: "api:orders/post", nodeId: "user", edgeId: "m1" },
      { ref: "db:orders", nodeId: "api", edgeId: "m4" },
      { ref: "db:order-items", nodeId: "api", edgeId: "m5" },
    ]);
  });

  test("the participant for the handler explains the endpoint; a message alone does not", () => {
    const kinds = { "place-order-handler": "flow" as const };
    const kindOf = (slug: string) => kinds[slug as keyof typeof kinds];
    const usesOf = (board: ReturnType<typeof sequence>): RefUse["usedIn"] => {
      const result = parseBoard(board);
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      return refsOf(result.value)
        .used.filter((u) => u.ref === "api:orders/post")
        .map((u) => ({ slug: "place-order-handler", ...u }));
    };
    expect(hasFlow({ usedIn: usesOf(sequence()) }, kindOf)).toBe(true);
    const messageOnly = sequence();
    delete (messageOnly.nodes[1] as Record<string, unknown>).ref;
    expect(hasFlow({ usedIn: usesOf(messageOnly) }, kindOf)).toBe(false);
  });
});

describe("pruneFragments", () => {
  test("drops an emptied operand, and lifts what an alt left with one branch held", () => {
    const board = sequence();
    // The declined branch loses its only message.
    board.edges.splice(6, 1);
    const pruned = pruneFragments(board as unknown as Record<string, unknown>);
    expect(parseBoard(pruned).ok).toBe(true);
    const fragments = pruned.fragments as Array<Record<string, unknown>>;
    // The alt is gone: its messages and its loop move to the top level.
    expect(fragments.map((f) => f.id)).toEqual(["lines"]);
    expect(fragments[0]?.parentOperandId).toBeUndefined();
    const edges = pruned.edges as Array<Record<string, unknown>>;
    expect(edges.find((e) => e.id === "m4")?.operandId).toBeUndefined();
    expect(edges.find((e) => e.id === "m5")?.operandId).toBe("each");
  });

  test("removes a loop left with no message, and the fragments field once none is left", () => {
    const board = sequence();
    board.edges.splice(4, 1);
    const pruned = pruneFragments(board as unknown as Record<string, unknown>);
    expect((pruned.fragments as Array<{ id: string }>).map((f) => f.id)).toEqual(["pay"]);
    expect(parseBoard(pruned).ok).toBe(true);
    const bare = { ...board, edges: board.edges.slice(0, 3) };
    const none = pruneFragments(bare as unknown as Record<string, unknown>);
    expect("fragments" in none).toBe(false);
    expect(parseBoard(none).ok).toBe(true);
  });

  test("leaves a board whose fragments all hold messages as it is", () => {
    const board = sequence() as unknown as Record<string, unknown>;
    expect(pruneFragments(board)).toEqual(board);
  });
});
