import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addEdge,
  addNode,
  newId,
  type RawBoard,
  removalOf,
  removeEdge,
  removeNode,
  setEdgeLabel,
  setNodeText,
} from "../src/board-edit.ts";
import { EditHistory } from "../src/edit-history.ts";

const examples = path.resolve(import.meta.dirname, "../../../examples");
const read = (file: string): RawBoard =>
  JSON.parse(readFileSync(path.join(examples, file), "utf8")) as RawBoard;
const node = (board: RawBoard, id: string) =>
  (board.nodes as Array<Record<string, unknown>>).find((n) => n.id === id);
const seq = () => {
  let n = 0;
  return () => (n++ % 36) / 36;
};

describe("setNodeText", () => {
  it("makes a reworded claim manual and moves its sources to priorSourceIds", () => {
    const board = read("checkout-flow.board.json");
    const before = node(board, "n-authorize") as Record<string, unknown>;
    const result = setNodeText(board, "n-authorize", "label", "Authorise the card twice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = node(result.board, "n-authorize") as Record<string, unknown>;
    expect(after).toMatchObject({ label: "Authorise the card twice", manual: true });
    expect(after.priorSourceIds).toEqual(before.sourceIds);
    expect("sourceIds" in after).toBe(false);
    // Every field it did not touch is kept as written, in its place.
    expect(Object.keys(result.board)).toEqual(Object.keys(board));
    expect(after.detail).toBe(before.detail);
    expect(node(result.board, "n-ready")).toEqual(node(board, "n-ready"));
  });

  it("changes nothing when the text is the same, and removes an emptied optional field", () => {
    const board = read("checkout-flow.board.json");
    const label = String(node(board, "n-ready")?.label);
    const same = setNodeText(board, "n-ready", "label", `  ${label} `);
    expect(same.ok && same.board).toBe(board);
    const emptied = setNodeText(board, "n-ready", "detail", "");
    expect(emptied.ok && "detail" in (node(emptied.board, "n-ready") ?? {})).toBe(false);
  });

  it("refuses an empty label", () => {
    const result = setNodeText(read("checkout-flow.board.json"), "n-ready", "label", " ");
    expect(result.ok).toBe(false);
  });
});

describe("addNode, addEdge", () => {
  it("adds a step without a source, manual, under a fresh id", () => {
    const board = read("checkout-flow.board.json");
    const result = addNode(board, { kind: "step", label: "Send a receipt" }, seq());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.id).toMatch(/^m-[a-z0-9]{6}$/);
    expect(node(result.board, result.id as string)).toEqual({
      id: result.id,
      kind: "step",
      label: "Send a receipt",
      manual: true,
    });
    const edge = addEdge(result.board, {
      from: "n-capture",
      to: result.id as string,
      kind: "flow",
    });
    expect(edge.ok).toBe(true);
  });

  it("refuses an element without a parent, and an edge to nowhere", () => {
    const board = read("checkout-flow.board.json");
    expect(addNode(board, { kind: "element", label: "Pay", role: "button" }).ok).toBe(false);
    expect(addEdge(board, { from: "n-ready", to: "ghost", kind: "flow" }).ok).toBe(false);
  });

  it("adds a table only with a db ref, which names it in the error otherwise", () => {
    const board = read("fixtures/.groundboard/overview-db.board.json");
    const added = addNode(board, { kind: "table", label: "Refunds", ref: "db:refunds" }, seq());
    expect(added.ok).toBe(true);
    const missing = addNode(board, { kind: "table", label: "Refunds" }, seq());
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.issues.map((i) => i.message).join()).toMatch(/needs a ref such as `db:orders`/);
  });

  it("never reuses an id", () => {
    const board = { nodes: [{ id: "m-aaaaaa" }], edges: [] };
    let calls = 0;
    // The first draw gives m-aaaaaa, which is taken; the next differs.
    const id = newId(board, () => (calls++ < 6 ? 0 : 0.5));
    expect(id).not.toBe("m-aaaaaa");
  });
});

describe("removeNode, removeEdge", () => {
  it("removes a screen with its elements, states, edges, and the sources only they cite", () => {
    const board = read("fixtures/states/.groundboard/web--users-upload.board.json");
    const preview = removalOf(board, "upload");
    expect(preview.nodes).toContain("validating");
    expect(preview.nodes).toContain("pick");
    expect(preview.edges).toContain("t-upload");
    // A board keeps at least one node: removing the last screen is refused, not half done.
    expect(removeNode(board, "upload").ok).toBe(false);
    const kept = addNode(board, { kind: "note", label: "Kept" });
    if (!kept.ok) throw new Error("fixture");
    const result = removeNode(kept.board, "upload");
    expect(result.ok, JSON.stringify(result.ok ? "" : result.issues)).toBe(true);
    if (!result.ok) return;
    expect((result.board.nodes as unknown[]).length).toBe(1);
    expect(result.board.edges).toEqual([]);
    // Only the two sources the fixture never cited are left: they were not the screen's.
    expect((result.board.sources as Array<{ id: string }>).map((s) => s.id)).toEqual([
      "route-users",
      "list-link",
    ]);
  });

  it("keeps sources another node still cites, and those already cited by nothing", () => {
    const board = read("checkout-flow.board.json");
    const orphan = { id: "orphan", path: "x.ts", line: 1, quote: "x" };
    const withOrphan = { ...board, sources: [...(board.sources as unknown[]), orphan] };
    const result = removeNode(withOrphan, "n-void");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.board.sources as Array<{ id: string }>).map((s) => s.id)).toContain("orphan");
    expect((result.board.edges as Array<{ id: string }>).map((e) => e.id)).not.toContain("e4");
  });

  it("removes an edge and relabels another, manual", () => {
    const board = read("checkout-flow.board.json");
    const removed = removeEdge(board, "e1");
    expect(removed.ok && (removed.board.edges as unknown[]).length).toBe(
      (board.edges as unknown[]).length - 1,
    );
    const relabelled = setEdgeLabel(board, "e2", "then");
    expect(relabelled.ok).toBe(true);
    if (relabelled.ok) {
      expect((relabelled.board.edges as Array<Record<string, unknown>>)[1]).toMatchObject({
        label: "then",
        manual: true,
      });
    }
  });
});

describe("EditHistory", () => {
  it("undoes and redoes, drops the undone steps on a new one, and keeps at most the limit", () => {
    const history = new EditHistory(0, 3);
    history.push(1);
    history.push(2);
    expect(history.undo()).toBe(1);
    expect(history.undo()).toBe(0);
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBe(1);
    history.push(5);
    expect(history.canRedo).toBe(false);
    for (const n of [6, 7, 8]) history.push(n);
    let steps = 0;
    while (history.undo() !== null) steps += 1;
    expect(steps).toBe(3);
    expect(history.current).toBe(5);
  });
});
