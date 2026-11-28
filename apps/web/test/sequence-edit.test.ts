import { parseBoard } from "@groundboard/schema";
import { describe, expect, it } from "vitest";
import { sequenceBoard } from "../../../packages/schema/test/sequence-board.ts";
import { type RawBoard, setNodeText } from "../src/board-edit.ts";
import { EditHistory } from "../src/edit-history.ts";
import {
  addMessage,
  addParticipant,
  messageMove,
  moveMessage,
  moveParticipant,
  participantRemoval,
  removeMessage,
  removeParticipant,
  setFragmentKind,
  setMessage,
  setOperandGuard,
  setParticipantCategory,
  splitOperand,
  unwrapFragment,
  wrapMessages,
} from "../src/sequence-edit.ts";

type Item = Record<string, unknown>;
const board = () => sequenceBoard() as unknown as RawBoard;
const nodes = (b: RawBoard) => b.nodes as Item[];
const edges = (b: RawBoard) => b.edges as Item[];
const fragments = (b: RawBoard) => (b.fragments ?? []) as Item[];
const edge = (b: RawBoard, id: string) => edges(b).find((e) => e.id === id) as Item;
const order = (b: RawBoard) => edges(b).map((e) => e.id);
const seq = () => {
  let n = 0;
  return () => (n++ % 36) / 36;
};
const ok = (result: { ok: boolean; issues?: unknown }) => {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result as { ok: true; board: RawBoard };
};

describe("participants", () => {
  it("rewords a participant (manual), changes its category (manual), and keeps the rest", () => {
    const reworded = ok(setNodeText(board(), "bank", "label", "Card gateway"));
    expect(nodes(reworded.board)[2]).toMatchObject({ label: "Card gateway", manual: true });
    const moved = ok(setParticipantCategory(board(), "bank", "system"));
    expect(nodes(moved.board)[2]).toMatchObject({
      category: "system",
      manual: true,
      priorSourceIds: ["gw"],
    });
    expect(setParticipantCategory(board(), "m1", "system").ok).toBe(false);
  });

  it("adds a participant after the selected one, manual, and refuses a category it lacks", () => {
    const added = addParticipant(
      board(),
      { label: "Fraud check", category: "external", afterId: "api" },
      seq(),
    );
    const result = ok(added);
    expect(nodes(result.board).map((n) => n.id)).toEqual([
      "user",
      "api",
      added.id,
      "bank",
      "db",
      "q",
    ]);
    expect(nodes(result.board)[2]).toMatchObject({ kind: "participant", manual: true });
    expect(addParticipant(board(), { label: "X", category: "robot" }).ok).toBe(false);
  });

  it("removes a participant with every message it sends or receives, and tidies the fragments", () => {
    expect(participantRemoval(board(), "q")).toEqual(["m6"]);
    const result = ok(removeParticipant(board(), "q"));
    expect(nodes(result.board).map((n) => n.id)).not.toContain("q");
    expect(order(result.board)).not.toContain("m6");
    // Removing the customer empties the declined branch: the alt goes, the loop stays.
    const customer = ok(removeParticipant(board(), "user"));
    expect(fragments(customer.board).map((f) => f.id)).toEqual(["lines"]);
    expect(parseBoard(customer.board).ok).toBe(true);
  });

  it("moves a column left or right without making anything manual", () => {
    const result = ok(moveParticipant(board(), "db", -1));
    expect(nodes(result.board).map((n) => n.id)).toEqual(["user", "api", "db", "bank", "q"]);
    expect(JSON.stringify(result.board)).not.toContain('"manual"');
    expect(moveParticipant(board(), "user", -1).ok).toBe(false);
    expect(moveParticipant(board(), "q", 1).ok).toBe(false);
  });
});

describe("messages", () => {
  it("changes a message's label, type and ends, and makes it manual", () => {
    const result = ok(
      setMessage(board(), "m2", { label: "authorize the amount", messageType: "async", to: "db" }),
    );
    expect(edge(result.board, "m2")).toMatchObject({
      label: "authorize the amount",
      messageType: "async",
      to: "db",
      manual: true,
      priorSourceIds: ["auth"],
    });
    expect(ok(setMessage(board(), "m3", { messageType: "sync" })).board.edges).not.toEqual(
      board().edges,
    );
    expect(setMessage(board(), "m2", { to: "nobody" }).ok).toBe(false);
    const same = setMessage(board(), "m2", { label: "authorize(amount)" });
    expect(same.ok && same.board).toEqual(board());
  });

  it("adds a message after the selected one, in its operand", () => {
    const added = addMessage(
      board(),
      { from: "api", to: "db", label: "lock the cart", afterId: "m4" },
      seq(),
    );
    const result = ok(added);
    expect(order(result.board).indexOf(added.id)).toBe(4);
    expect(edge(result.board, added.id as string)).toMatchObject({ operandId: "ok", manual: true });
    expect(addMessage(board(), { from: "api", to: "nobody", label: "x" }).ok).toBe(false);
  });

  it("removes a message and the fragments it leaves empty", () => {
    const result = ok(removeMessage(board(), "m5"));
    expect(fragments(result.board).map((f) => f.id)).toEqual(["pay"]);
    expect(removeMessage(board(), "nope").ok).toBe(true);
  });

  it("swaps a message with its neighbour in the same operand, the moved one manual", () => {
    const result = ok(moveMessage(board(), "m2", 1));
    expect(order(result.board).slice(0, 3)).toEqual(["m1", "m3", "m2"]);
    expect(edge(result.board, "m2").manual).toBe(true);
    expect(edge(result.board, "m3").manual).toBeUndefined();
    expect(moveMessage(board(), "m1", -1).ok).toBe(false);
  });

  it("at the edge of an operand, leaves it; next to a fragment, enters it", () => {
    // m4 is first in operand ok, which is first in the alt: up, it leaves the alt.
    expect(messageMove(board(), "m4", -1)).toEqual({
      kind: "leave",
      operandId: "ok",
      to: undefined,
    });
    // m7 is first in declined: up, it joins ok, the operand before it.
    expect(messageMove(board(), "m7", -1)).toEqual({
      kind: "leave",
      operandId: "declined",
      to: "ok",
    });
    // m5 is alone in the loop: down, it leaves the loop into ok.
    expect(messageMove(board(), "m5", 1)).toEqual({ kind: "leave", operandId: "each", to: "ok" });
    // m3 is right above the alt: down, it enters it as the first message of ok.
    expect(messageMove(board(), "m3", 1)).toEqual({ kind: "enter", operandId: "ok" });
    const left = ok(moveMessage(board(), "m4", -1));
    expect(edge(left.board, "m4").operandId).toBeUndefined();
    expect(edge(left.board, "m4").manual).toBe(true);
    // Moving m7 up empties the declined branch: the alt, left with one, is removed.
    const merged = ok(moveMessage(board(), "m7", -1));
    expect(fragments(merged.board).map((f) => f.id)).toEqual(["lines"]);
    expect(edge(merged.board, "m7").operandId).toBeUndefined();
    expect(messageMove(board(), "m7", 1)).toEqual({
      kind: "leave",
      operandId: "declined",
      to: undefined,
    });
  });
});

describe("fragments", () => {
  it("wraps messages that follow each other in an opt inside the operand they share", () => {
    const wrapped = wrapMessages(
      board(),
      ["m4", "m5", "m6"],
      "opt",
      "the cart is not empty",
      seq(),
    );
    const result = ok(wrapped);
    const fragment = fragments(result.board).find((f) => f.id === wrapped.id) as Item;
    expect(fragment).toMatchObject({ kind: "opt", parentOperandId: "ok", manual: true });
    const operand = (fragment.operands as Item[])[0] as Item;
    expect(operand.guard).toBe("the cart is not empty");
    expect(edge(result.board, "m4").operandId).toBe(operand.id);
    // The loop moves in with its message.
    expect(fragments(result.board).find((f) => f.id === "lines")?.parentOperandId).toBe(operand.id);
    expect(wrapMessages(board(), ["m2", "m4"], "opt", "").ok).toBe(false);
    // A message at the top level and one inside the alt: the frame would hold only one of them.
    const partial = wrapMessages(board(), ["m3", "m4"], "opt", "");
    expect(partial.ok).toBe(false);
    expect(partial.ok ? "" : partial.issues[0]?.message).toContain(
      "crosses the edge of a fragment",
    );
    // Across the alt's two branches there is no shared operand to wrap in.
    expect(wrapMessages(board(), ["m6", "m7"], "opt", "").ok).toBe(false);
  });

  it("wraps in an alt with the last message as the second branch, and refuses one message", () => {
    const wrapped = wrapMessages(board(), ["m1", "m2", "m3"], "alt", "the order is new", seq());
    const result = ok(wrapped);
    const fragment = fragments(result.board).find((f) => f.id === wrapped.id) as Item;
    const [first, second] = fragment.operands as Item[];
    expect(edge(result.board, "m2").operandId).toBe(first?.id);
    expect(edge(result.board, "m3").operandId).toBe(second?.id);
    expect(wrapMessages(board(), ["m1"], "alt", "").ok).toBe(false);
  });

  it("splits an alt's operand at a message, and refuses a loop's", () => {
    const split = splitOperand(board(), "m6", seq());
    const result = ok(split);
    const pay = fragments(result.board).find((f) => f.id === "pay") as Item;
    expect((pay.operands as Item[]).map((o) => o.id)).toEqual(["ok", split.id, "declined"]);
    expect(edge(result.board, "m6").operandId).toBe(split.id);
    expect(pay.manual).toBe(true);
    expect(splitOperand(board(), "m5").ok).toBe(false);
    expect(splitOperand(board(), "m1").ok).toBe(false);
  });

  it("changes alt to par and keeps the operands, and refuses an alt of two as a loop", () => {
    const result = ok(setFragmentKind(board(), "pay", "par"));
    expect(fragments(result.board)[0]).toMatchObject({ kind: "par", manual: true });
    expect(setFragmentKind(board(), "pay", "loop").ok).toBe(false);
    expect(ok(setFragmentKind(board(), "lines", "opt")).board).toBeDefined();
    expect(setFragmentKind(board(), "lines", "alt").ok).toBe(false);
  });

  it("rewords a guard (manual, sources kept as prior) and removes an emptied one", () => {
    const result = ok(setOperandGuard(board(), "each", "each line of the cart"));
    const loop = fragments(result.board).find((f) => f.id === "lines") as Item;
    expect((loop.operands as Item[])[0]).toMatchObject({
      guard: "each line of the cart",
      manual: true,
      priorSourceIds: ["for"],
    });
    const emptied = ok(setOperandGuard(board(), "each", ""));
    expect(((fragments(emptied.board)[1] as Item).operands as Item[])[0]?.guard).toBeUndefined();
    expect(setOperandGuard(board(), "nope", "x").ok).toBe(false);
  });

  it("unwraps a fragment: its messages and fragments move to the operand around it", () => {
    const result = ok(unwrapFragment(board(), "pay"));
    expect(fragments(result.board).map((f) => f.id)).toEqual(["lines"]);
    expect(fragments(result.board)[0]?.parentOperandId).toBeUndefined();
    expect(edge(result.board, "m4").operandId).toBeUndefined();
    expect(edge(result.board, "m7").operandId).toBeUndefined();
    // The guard's source, cited by nothing else now, is dropped.
    expect((result.board.sources as Item[]).map((s) => s.id)).not.toContain("if-ok");
    const inner = ok(unwrapFragment(board(), "lines"));
    expect(edge(inner.board, "m5").operandId).toBe("ok");
    expect(unwrapFragment(board(), "nope").ok).toBe(false);
  });
});

describe("a long run of edits", () => {
  it("never leaves a broken board, and undoing every step gives the board back", () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)] as T;
    const start = board();
    const history = new EditHistory<RawBoard>(start, 1000);
    let current = start;
    let applied = 0;
    for (let i = 0; i < 200; i++) {
      const messageIds = edges(current).map((e) => String(e.id));
      const participantIds = nodes(current)
        .filter((n) => n.kind === "participant")
        .map((n) => String(n.id));
      const operandIds = fragments(current).flatMap((f) =>
        (f.operands as Item[]).map((o) => String(o.id)),
      );
      const fragmentIds = fragments(current).map((f) => String(f.id));
      const ops = [
        () => moveMessage(current, pick(messageIds), pick([-1, 1] as const)),
        () => moveParticipant(current, pick(participantIds), pick([-1, 1] as const)),
        () =>
          addMessage(
            current,
            {
              from: pick(participantIds),
              to: pick(participantIds),
              label: `m${i}`,
              afterId: pick(messageIds),
            },
            random,
          ),
        () =>
          setMessage(current, pick(messageIds), { messageType: pick(["sync", "reply", "async"]) }),
        () => {
          const k = Math.floor(random() * messageIds.length);
          return wrapMessages(
            current,
            messageIds.slice(k, k + 2),
            pick(["opt", "loop", "alt"] as const),
            "maybe",
            random,
          );
        },
        () => (operandIds.length ? setOperandGuard(current, pick(operandIds), `g${i}`) : null),
        () =>
          fragmentIds.length
            ? setFragmentKind(
                current,
                pick(fragmentIds),
                pick(["alt", "par", "opt", "loop"] as const),
              )
            : null,
        () => (messageIds.length > 3 ? splitOperand(current, pick(messageIds), random) : null),
        () =>
          fragmentIds.length && random() < 0.3 ? unwrapFragment(current, pick(fragmentIds)) : null,
        () =>
          messageIds.length > 4 && random() < 0.3 ? removeMessage(current, pick(messageIds)) : null,
        () =>
          participantIds.length > 3 && random() < 0.1
            ? removeParticipant(current, pick(participantIds))
            : null,
        () =>
          addParticipant(
            current,
            { label: `p${i}`, category: pick(["person", "system"]), afterId: pick(participantIds) },
            random,
          ),
      ];
      const result = pick(ops)();
      if (result === null || !result.ok || result.board === current) continue;
      expect(parseBoard(result.board).ok, `step ${i}`).toBe(true);
      history.push(result.board);
      current = result.board;
      applied += 1;
    }
    expect(applied).toBeGreaterThan(50);
    let back: RawBoard | null = current;
    for (let i = 0; i < applied; i++) back = history.undo() ?? back;
    expect(back).toEqual(start);
  });
});
