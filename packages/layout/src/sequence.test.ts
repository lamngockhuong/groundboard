import { type Board, parseBoard } from "@groundboard/schema";
import { describe, expect, test, vi } from "vitest";
import { sequenceBoard } from "../../schema/test/sequence-board.ts";
import { layoutBoard } from "./layout.ts";
import { layoutSequence } from "./sequence.ts";
import type { LaidOutBoard, LaidOutText } from "./types.ts";

// ELK must never start for a sequence board: constructing it fails the test.
vi.mock("elkjs/lib/elk.bundled.js", () => ({
  default: class {
    constructor() {
      throw new Error("ELK was started for a sequence board");
    }
  },
}));

function parse(raw: unknown): Board {
  const result = parseBoard(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Every box of text the diagram draws, with what it is, for the overlap check. */
function textBoxes(laidOut: LaidOutBoard): Array<{ what: string; box: Box }> {
  const out: Array<{ what: string; box: Box }> = [];
  for (const node of laidOut.nodes) out.push({ what: `node ${node.id}`, box: node });
  for (const edge of laidOut.edges) {
    if (edge.label) out.push({ what: `label ${edge.id}`, box: edge.label });
  }
  for (const fragment of laidOut.sequence?.fragments ?? []) {
    out.push({ what: `tag ${fragment.id}`, box: fragment.tag });
    if (fragment.label) out.push({ what: `label ${fragment.id}`, box: fragment.label });
    for (const operand of fragment.operands) {
      if (operand.guard)
        out.push({ what: `guard ${operand.id}`, box: operand.guard as LaidOutText });
    }
  }
  return out;
}

function expectNoOverlap(laidOut: LaidOutBoard) {
  const boxes = textBoxes(laidOut);
  const hits: string[] = [];
  boxes.forEach((a, i) => {
    for (const b of boxes.slice(i + 1))
      if (overlaps(a.box, b.box)) hits.push(`${a.what} × ${b.what}`);
  });
  expect(hits).toEqual([]);
}

const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

describe("layoutSequence", () => {
  const board = parse(sequenceBoard());
  const laidOut = layoutSequence(board);
  const column = (id: string) => laidOut.sequence?.lifelines.find((l) => l.participantId === id);

  test("puts the participants in a row in board order, wide enough apart for every label", () => {
    const xs = (laidOut.sequence?.lifelines ?? []).map((l) => l.x);
    expect(laidOut.sequence?.lifelines.map((l) => l.participantId)).toEqual([
      "user",
      "api",
      "bank",
      "db",
      "q",
    ]);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1] as number);
    for (const edge of laidOut.edges) {
      const a = column(edge.from)?.x as number;
      const b = column(edge.to)?.x as number;
      expect(Math.abs(b - a), edge.id).toBeGreaterThanOrEqual((edge.label?.width ?? 0) + 24);
      // The label sits between the two columns.
      expect(edge.label?.x).toBeGreaterThanOrEqual(Math.min(a, b));
      expect((edge.label?.x ?? 0) + (edge.label?.width ?? 0)).toBeLessThanOrEqual(Math.max(a, b));
    }
    // Neighbouring boxes never touch.
    const heads = laidOut.nodes.filter((n) => n.kind === "participant");
    for (let i = 1; i < heads.length; i++) {
      const left = heads[i - 1] as Box;
      expect((heads[i] as Box).x).toBeGreaterThan(left.x + left.width);
    }
  });

  test("numbers the messages and sends them strictly downwards, in message order", () => {
    expect(laidOut.edges.map((e) => [e.id, e.number, e.messageType])).toEqual([
      ["m1", 1, "sync"],
      ["m2", 2, "sync"],
      ["m3", 3, "reply"],
      ["m4", 4, "sync"],
      ["m5", 5, "sync"],
      ["m6", 6, "async"],
      ["m7", 7, "reply"],
    ]);
    expect(laidOut.edges.map((e) => e.label?.text)).toEqual([
      "1. POST /api/orders",
      "2. authorize(amount)",
      "3. authorization id",
      "4. insert order",
      "5. insert line",
      "6. send-receipt (async)",
      "7. 402 declined",
    ]);
    const ys = laidOut.edges.map((e) => e.points[0]?.[1] as number);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1] as number);
    for (const edge of laidOut.edges) {
      expect(edge.points).toHaveLength(2);
      expect(edge.points[0]?.[1]).toBe(edge.points[1]?.[1]);
    }
  });

  test("frames the loop inside operand ok of the alt, and the alt around it", () => {
    const fragments = laidOut.sequence?.fragments ?? [];
    const alt = fragments.find((f) => f.id === "pay");
    const loop = fragments.find((f) => f.id === "lines");
    if (!alt || !loop) throw new Error("missing fragment");
    expect(alt.depth).toBe(1);
    expect(loop.depth).toBe(2);
    expect(inside(loop, alt)).toBe(true);
    expect(alt.x).toBeLessThan(loop.x);
    const [ok, declined] = alt.operands;
    expect(ok?.y).toBe(alt.y);
    expect(loop.y).toBeGreaterThan(ok?.y as number);
    expect(loop.y + loop.height).toBeLessThanOrEqual(declined?.y as number);
    expect(alt.tag.text).toBe("alt");
    expect(ok?.guard?.text).toBe("[authorized]");
    expect(declined?.guard?.text).toBe("[declined]");
    expect(loop.operands[0]?.guard?.text).toBe("[each cart line]");
    // Each message sits in the frames of its operands, and the reply to the customer in the
    // declined branch below the divider.
    const row = (id: string) => laidOut.edges.find((e) => e.id === id)?.points[0]?.[1] as number;
    for (const id of ["m4", "m5", "m6"]) {
      expect(row(id)).toBeGreaterThan(alt.y);
      expect(row(id)).toBeLessThan(declined?.y as number);
    }
    expect(row("m5")).toBeGreaterThan(loop.y);
    expect(row("m5")).toBeLessThan(loop.y + loop.height);
    expect(row("m7")).toBeGreaterThan(declined?.y as number);
    expect(row("m7")).toBeLessThan(alt.y + alt.height);
    for (const id of ["m1", "m2", "m3"]) expect(row(id)).toBeLessThan(alt.y);
  });

  test("draws no two boxes of text over each other", () => {
    expectNoOverlap(laidOut);
  });

  test("runs every lifeline from its box to below the last row", () => {
    const last = Math.max(...laidOut.edges.flatMap((e) => e.points.map((p) => p[1])));
    for (const line of laidOut.sequence?.lifelines ?? []) {
      const head = laidOut.nodes.find((n) => n.id === line.participantId) as Box;
      expect(line.y1).toBe(head.y + head.height);
      expect(line.y2).toBeGreaterThan(last);
      expect(line.x).toBe(head.x + head.width / 2);
    }
    expect(laidOut.height).toBeGreaterThan(
      Math.max(...(laidOut.sequence?.lifelines ?? []).map((l) => l.y2)),
    );
  });

  test("gives the same result twice", () => {
    expect(layoutSequence(parse(sequenceBoard()))).toEqual(laidOut);
  });

  test("draws a message to itself as a loop with room for its label before the next column", () => {
    const raw = sequenceBoard();
    raw.edges.splice(2, 0, {
      id: "self",
      kind: "message",
      from: "api",
      to: "api",
      label: "check the amount against the cart total",
      sourceIds: ["auth"],
    });
    const out = layoutSequence(parse(raw));
    const self = out.edges.find((e) => e.id === "self");
    expect(self?.points).toHaveLength(4);
    const api = out.sequence?.lifelines.find((l) => l.participantId === "api")?.x as number;
    const bank = out.sequence?.lifelines.find((l) => l.participantId === "bank")?.x as number;
    expect((self?.label?.x ?? 0) + (self?.label?.width ?? 0)).toBeLessThanOrEqual(bank);
    expect(self?.points[1]?.[0]).toBeGreaterThan(api);
    expectNoOverlap(out);
  });

  test("lays out one participant and no message, and puts questions and notes in a column right", () => {
    const one = layoutSequence(
      parse({
        schemaVersion: 1,
        title: "One",
        question: "Who?",
        nodes: [{ id: "u", kind: "participant", category: "person", label: "Customer" }],
      }),
    );
    expect(one.nodes).toHaveLength(1);
    expect(one.edges).toEqual([]);
    expect(one.sequence?.fragments).toEqual([]);
    const raw = sequenceBoard();
    raw.nodes.push({ id: "ask", kind: "question", label: "Who retries a timeout? (Payments)" });
    raw.nodes.push({ id: "n", kind: "note", label: "Amounts are in cents" });
    const out = layoutSequence(parse(raw));
    const right = Math.max(
      ...out.nodes.filter((n) => n.kind === "participant").map((n) => n.x + n.width),
      ...(out.sequence?.fragments ?? []).map((f) => f.x + f.width),
    );
    const ask = out.nodes.find((n) => n.id === "ask") as Box;
    const note = out.nodes.find((n) => n.id === "n") as Box;
    expect(ask.x).toBeGreaterThan(right);
    expect(note.x).toBe(ask.x);
    expect(note.y).toBeGreaterThan(ask.y + ask.height);
    expect(out.width).toBeGreaterThan(ask.x + ask.width);
  });

  test("layoutBoard takes the sequence path without starting ELK", async () => {
    expect(await layoutBoard(board)).toEqual(laidOut);
  });

  test("lays out 200 messages, 12 participants and 30 fragments four deep within 50 ms", () => {
    const participants = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      kind: "participant",
      category: i === 0 ? "person" : "system",
      label: `Participant ${i}`,
      ...(i === 0 ? {} : { sourceIds: ["s"] }),
    }));
    // 30 fragments in 6 chains of 5 levels? Four deep at most: 6 stacks of opt > loop > opt > loop,
    // and 6 alts at the top level.
    const fragments: Array<Record<string, unknown>> = [];
    const edges: Array<Record<string, unknown>> = [];
    let m = 0;
    const message = (operandId?: string) => {
      const from = m % 12;
      const to = (m * 5 + 3) % 12;
      edges.push({
        id: `m${m}`,
        kind: "message",
        from: `p${from}`,
        to: `p${to}`,
        label: `call number ${m}`,
        sourceIds: ["s"],
        ...(operandId ? { operandId } : {}),
      });
      m += 1;
    };
    for (let s = 0; s < 6; s++) {
      for (let d = 0; d < 4; d++) {
        fragments.push({
          id: `f${s}-${d}`,
          kind: d % 2 === 0 ? "opt" : "loop",
          ...(d > 0 ? { parentOperandId: `o${s}-${d - 1}` } : {}),
          operands: [{ id: `o${s}-${d}` }],
        });
      }
      for (let d = 0; d < 4; d++) for (let k = 0; k < 5; k++) message(`o${s}-${d}`);
      fragments.push({
        id: `a${s}`,
        kind: "alt",
        operands: [{ id: `a${s}-0` }, { id: `a${s}-1` }],
      });
      for (let k = 0; k < 6; k++) message(`a${s}-${k < 3 ? 0 : 1}`);
      for (let k = 0; k < 7; k++) message();
    }
    while (m < 200) message();
    const big = parse({
      schemaVersion: 1,
      title: "Big",
      question: "Does a big sequence lay out fast?",
      nodes: participants,
      edges,
      fragments,
      sources: [{ id: "s", path: "src/a.ts", line: 1, quote: "a" }],
    });
    expect(fragments).toHaveLength(30);
    layoutSequence(big);
    const start = performance.now();
    const out = layoutSequence(big);
    expect(performance.now() - start).toBeLessThan(50);
    expect(out.edges).toHaveLength(200);
    expect(Math.max(...(out.sequence?.fragments ?? []).map((f) => f.depth))).toBe(4);
  });
});
