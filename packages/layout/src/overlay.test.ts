import { readFileSync } from "node:fs";
import path from "node:path";
import { type Board, emptyOverlay, type Overlay, parseBoard } from "@groundboard/schema";
import { describe, expect, it } from "vitest";
import { layoutBoard } from "./layout.ts";
import { applyOverlay } from "./overlay.ts";
import type { LaidOutBoard, LaidOutNode } from "./types.ts";

const examples = path.resolve(import.meta.dirname, "../../../examples");

function load(file: string): Board {
  const parsed = parseBoard(JSON.parse(readFileSync(path.join(examples, file), "utf8")));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
}

const overlay = (nodes: Overlay["nodes"], notes: Overlay["notes"] = []): Overlay => ({
  ...emptyOverlay(),
  nodes,
  notes,
});
const node = (laidOut: LaidOutBoard, id: string) =>
  laidOut.nodes.find((n) => n.id === id) as LaidOutNode;

describe("applyOverlay", () => {
  it("changes nothing with an empty overlay", async () => {
    const board = load("checkout-flow.board.json");
    const laidOut = await layoutBoard(board);
    const result = applyOverlay(laidOut, board, emptyOverlay());
    expect(result.laidOut).toEqual(laidOut);
    expect(result.warnings).toEqual([]);
  });

  it("moves a node, refits its group, and redraws an edge with one end moved straight", async () => {
    const board = load("checkout-flow.board.json");
    const laidOut = await layoutBoard(board);
    const result = applyOverlay(laidOut, board, overlay({ "n-capture": { dx: 300, dy: 400 } }));
    const before = node(laidOut, "n-capture");
    const after = node(result.laidOut, "n-capture");
    expect([after.x, after.y]).toEqual([before.x + 300, before.y + 400]);
    // Unmoved nodes stay.
    expect(node(result.laidOut, "n-ready")).toEqual(node(laidOut, "n-ready"));
    // e3: n-reserve -> n-capture, one end moved: a straight segment between the two boxes.
    const edge = result.laidOut.edges.find((e) => e.id === "e3");
    expect(edge?.points).toHaveLength(2);
    const [start, end] = edge?.points ?? [];
    const reserve = node(result.laidOut, "n-reserve");
    expect(start?.[0]).toBeGreaterThanOrEqual(reserve.x);
    expect(start?.[0]).toBeLessThanOrEqual(reserve.x + reserve.width);
    expect(end?.[1]).toBeCloseTo(after.y, 0);
    // The group grows to hold the moved node, and so does the board.
    const group = result.laidOut.groups.find((g) => g.id === "g-checkout");
    expect((group?.y ?? 0) + (group?.height ?? 0)).toBeGreaterThan(after.y + after.height);
    expect(result.laidOut.height).toBeGreaterThan(laidOut.height);
  });

  it("moves a screen family whole: states, elements, markers and internal routes", async () => {
    const board = load("fixtures/states/.groundboard/web--users-upload.board.json");
    const laidOut = await layoutBoard(board);
    const d = { dx: 120, dy: -40 };
    const result = applyOverlay(laidOut, board, overlay({ upload: d }));
    for (const id of ["upload", "validating", "pick", "confirm-cancel"]) {
      const a = node(laidOut, id);
      const b = node(result.laidOut, id);
      expect([b.x, b.y], id).toEqual([a.x + d.dx, a.y + d.dy]);
    }
    // An edge between two frames of the family moves with them, bend for bend.
    const inside = (id: string, l: LaidOutBoard) => l.edges.find((e) => e.id === id);
    const before = inside("t-ok", laidOut);
    const after = inside("t-ok", result.laidOut);
    expect(after?.points).toEqual(before?.points.map(([x, y]) => [x + d.dx, y + d.dy]));
    // A marker's tag and list line follow their frame.
    const marker = inside("nav-crumb", laidOut)?.marker;
    const moved = inside("nav-crumb", result.laidOut)?.marker;
    expect(moved?.tag.x).toBe((marker?.tag.x ?? 0) + d.dx);
    expect(moved?.line.y).toBe((marker?.line.y ?? 0) + d.dy);
    expect(result.warnings).toEqual([]);
  });

  it("ignores offsets of states, elements and unknown ids, and says so", async () => {
    const board = load("fixtures/states/.groundboard/web--users-upload.board.json");
    const laidOut = await layoutBoard(board);
    const result = applyOverlay(
      laidOut,
      board,
      overlay({ validating: { dx: 5, dy: 5 }, pick: { dx: 5, dy: 5 }, ghost: { dx: 5, dy: 5 } }),
    );
    expect(result.laidOut.nodes).toEqual(laidOut.nodes);
    expect(result.warnings).toEqual([
      "overlay: `validating` moves with `upload`; its own offset is ignored",
      "overlay: `pick` moves with `upload`; its own offset is ignored",
      "overlay: `ghost` is not on the board; its offset is ignored",
    ]);
  });

  it("places anchored notes by their node, and keeps an orphan note where it was drawn", async () => {
    const board = load("checkout-flow.board.json");
    const laidOut = await layoutBoard(board);
    const base = { type: "text" as const, width: 80, height: 20, text: "Why?" };
    const result = applyOverlay(
      laidOut,
      board,
      overlay({ "n-void": { dx: 50, dy: 0 } }, [
        { ...base, id: "a", x: 0, y: 0, anchor: { nodeId: "n-void", dx: 10, dy: -30 } },
        { ...base, id: "b", x: 7, y: 9, anchor: { nodeId: "gone", dx: 1, dy: 1 } },
        { ...base, id: "c", x: 3, y: 4 },
      ]),
    );
    const voidNode = node(result.laidOut, "n-void");
    expect(result.notes.map((n) => [n.id, n.x, n.y])).toEqual([
      ["a", voidNode.x + 10, voidNode.y - 30],
      ["b", 7, 9],
      ["c", 3, 4],
    ]);
    expect(result.warnings).toContain(
      "overlay: note `b` follows `gone`, which is not on the board; it stays where it was drawn",
    );
  });

  it("keeps a nudge when a node is added and the layout changes", async () => {
    const board = load("checkout-flow.board.json");
    const grown = parseBoard({
      ...JSON.parse(readFileSync(path.join(examples, "checkout-flow.board.json"), "utf8")),
    });
    if (!grown.ok) throw new Error("fixture");
    grown.value.nodes.push({
      id: "n-new",
      kind: "note",
      label: "Added later",
      sourceIds: [],
    } as never);
    const nudge = overlay({ "n-capture": { dx: 0, dy: 90 } });
    for (const b of [board, grown.value]) {
      const laidOut = await layoutBoard(b);
      const before = node(laidOut, "n-capture");
      const after = node(applyOverlay(laidOut, b, nudge).laidOut, "n-capture");
      expect(after.x - before.x).toBeCloseTo(0, 6);
      expect(after.y - before.y).toBeCloseTo(90, 6);
    }
  });

  it("warns when a moved box lands on another", async () => {
    const board = load("checkout-flow.board.json");
    const laidOut = await layoutBoard(board);
    const a = node(laidOut, "n-ready");
    const b = node(laidOut, "n-authorize");
    const result = applyOverlay(
      laidOut,
      board,
      overlay({ "n-ready": { dx: b.x - a.x, dy: b.y - a.y } }),
    );
    expect(result.warnings).toEqual(["overlay: `n-ready` was moved onto `n-authorize`"]);
  });

  it("moves a table's column rows with the table", async () => {
    const parsed = parseBoard(
      JSON.parse(
        readFileSync(path.join(examples, "fixtures/.groundboard/overview-db.board.json"), "utf8"),
      ),
    );
    if (!parsed.ok) throw new Error("fixture");
    const laidOut = await layoutBoard(parsed.value);
    const result = applyOverlay(laidOut, parsed.value, overlay({ orders: { dx: 30, dy: 10 } }));
    const before = node(laidOut, "@col:orders/email");
    const after = node(result.laidOut, "@col:orders/email");
    expect([after.x - before.x, after.y - before.y]).toEqual([30, 10]);
    expect(result.warnings).toEqual([]);
  });
});
