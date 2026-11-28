import { readFileSync } from "node:fs";
import path from "node:path";
import { type Board, parseBoard } from "@groundboard/schema";
import { describe, expect, test } from "vitest";
import { endpointGuardText, endpointRowText, layoutCard } from "./card.ts";
import { layoutBoard } from "./layout.ts";
import { applyOverlay } from "./overlay.ts";

const atlas = path.resolve(import.meta.dirname, "../../../examples/fixtures/.groundboard");

function load(slug: string): Board {
  const parsed = parseBoard(
    JSON.parse(readFileSync(path.join(atlas, `${slug}.board.json`), "utf8")),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
}

describe("cards", () => {
  test("stack one row per item, each as tall as its text", () => {
    const card = layoutCard([
      { id: "a", text: "GET /orders  List orders" },
      { id: "b", text: `POST /orders  ${"Place an order with a long description ".repeat(4)}` },
    ]);
    expect(card.boxes.map((b) => b.id)).toEqual(["a", "b"]);
    const [a, b] = card.boxes;
    expect((b?.y ?? 0) > (a?.y ?? 0) + (a?.height ?? 0)).toBe(true);
    expect((b?.height ?? 0) > (a?.height ?? 0)).toBe(true);
    expect(card.height).toBeGreaterThan((b?.y ?? 0) + (b?.height ?? 0));
  });

  test("an endpoint's row reads its method, path and label", () => {
    expect(endpointRowText({ method: "GET", path: "/orders/:id", label: "Read one" })).toBe(
      "GET /orders/:id  Read one",
    );
  });

  test("a resource is laid out as a frame with its endpoints as rows inside it", async () => {
    const laidOut = await layoutBoard(load("api--orders"));
    const resource = laidOut.nodes.find((n) => n.id === "orders");
    expect(resource?.shape).toBe("frame");
    for (const id of ["create-order", "get-order"]) {
      const row = laidOut.nodes.find((n) => n.id === id);
      expect(row?.shape, id).toBe("wire");
      expect(row?.screenId).toBe("orders");
      expect(row?.x).toBeGreaterThanOrEqual(resource?.x ?? 0);
      expect(row?.y).toBeGreaterThanOrEqual(resource?.y ?? 0);
    }
  });

  test("an endpoint's row grows by its guard line and its tags, which wrap at the row's edge", () => {
    const plain = layoutCard([{ id: "a", text: "POST /api/orders  Place an order" }]);
    const tags = ["orders", "order-items", "send-receipt"].map((name, i) => ({
      edgeId: `e${i}`,
      ref: `db:${name}`,
      kind: "writes" as const,
      text: `writes ${name}`,
    }));
    const full = layoutCard([
      {
        id: "a",
        text: "POST /api/orders  Place an order",
        guard: { text: "guard: requireCustomer", empty: false },
        tags,
      },
    ]);
    const [p] = plain.boxes;
    const [f] = full.boxes;
    expect((f?.height ?? 0) > (p?.height ?? 0)).toBe(true);
    expect(f?.parts?.guard?.text).toBe("guard: requireCustomer");
    expect(f?.parts?.tags.map((t) => t.text)).toEqual(tags.map((t) => t.text));
    // Every part sits inside the row, below its first line.
    for (const part of [f?.parts?.guard, ...(f?.parts?.tags ?? [])]) {
      if (!part || !f) throw new Error("missing part");
      expect(part.y).toBeGreaterThanOrEqual(f.textY + f.textHeight);
      expect(part.x + part.width).toBeLessThanOrEqual(f.x + f.width);
      expect(part.y + part.height).toBeLessThanOrEqual(f.y + f.height);
    }
    const many = layoutCard([
      {
        id: "a",
        text: "POST /api/orders",
        tags: Array.from({ length: 8 }, (_, i) => ({ ...tags[0], edgeId: `t${i}` })) as never,
      },
    ]);
    const ys = new Set(many.boxes[0]?.parts?.tags.map((t) => t.y));
    expect(ys.size).toBeGreaterThan(1);
  });

  test("the guard line names the guards, says when none was found, and is absent when unread", () => {
    expect(endpointGuardText({})).toBeUndefined();
    expect(endpointGuardText({ guards: [] })).toEqual({ text: "no guard found", empty: true });
    expect(
      endpointGuardText({
        guards: [
          { name: "requireCustomer", sourceIds: [] },
          { name: "role: admin", sourceIds: [] },
        ],
      }),
    ).toEqual({ text: "guard: requireCustomer · role: admin", empty: false });
  });

  test("reads, writes and enqueues out of an endpoint are tags in its row, with no chip or marker", async () => {
    const board = load("api--orders");
    const laidOut = await layoutBoard(board);
    expect(laidOut.nodes.filter((n) => n.shape === "chip")).toEqual([]);
    for (const id of ["create-writes", "create-enqueues", "get-reads"]) {
      const edge = laidOut.edges.find((e) => e.id === id);
      expect(edge?.marker, id).toBeUndefined();
      expect(edge?.points, id).toEqual([]);
      expect(edge?.inRow?.rowId).toBe(edge?.from);
    }
    const create = laidOut.nodes.find((n) => n.id === "create-order");
    expect(create?.rowParts?.tags.map((t) => [t.text, t.edgeId])).toEqual([
      ["writes orders", "create-writes"],
      ["enqueues send-receipt", "create-enqueues"],
    ]);
    const resource = laidOut.nodes.find((n) => n.id === "orders");
    for (const tag of create?.rowParts?.tags ?? []) {
      expect(tag.x).toBeGreaterThanOrEqual(create?.x ?? 0);
      expect(tag.y + tag.height).toBeLessThanOrEqual((resource?.y ?? 0) + (resource?.height ?? 0));
    }
  });

  test("tags move with their card, and an overlay offset for a chip that is gone is ignored", async () => {
    const board = load("api--orders");
    const laidOut = await layoutBoard(board);
    const { laidOut: moved, warnings } = applyOverlay(laidOut, board, {
      version: 1,
      nodes: { orders: { dx: 100, dy: 50 }, "@ref:db:orders": { dx: 10, dy: 10 } },
      notes: [],
    } as never);
    const before = laidOut.nodes.find((n) => n.id === "create-order")?.rowParts?.tags[0];
    const after = moved.nodes.find((n) => n.id === "create-order")?.rowParts?.tags[0];
    expect(after?.x).toBe((before?.x ?? 0) + 100);
    expect(after?.y).toBe((before?.y ?? 0) + 50);
    expect(warnings.join(" ")).toContain("`@ref:db:orders` is not on the board");
  });

  test("a calls edge to an endpoint on another board is drawn as a marker beside its screen", async () => {
    const laidOut = await layoutBoard(load("web--checkout"));
    const call = laidOut.edges.find((e) => e.id === "pay-orders");
    expect(call?.marker?.screenId).toBe("checkout");
    expect(call?.marker?.line.text).toContain("api:orders/post");
    expect(call?.points).toEqual([]);
  });

  test("a table is a frame with one row per column, and the rows move with it", async () => {
    const board = load("overview-db");
    const laidOut = await layoutBoard(board);
    const table = laidOut.nodes.find((n) => n.id === "orders");
    expect(table?.shape).toBe("frame");
    const rows = laidOut.nodes.filter((n) => n.kind === "column" && n.screenId === "orders");
    expect(rows.map((r) => r.id)).toEqual([
      "@col:orders/id",
      "@col:orders/email",
      "@col:orders/status",
      "@col:orders/created-at",
    ]);
    expect(rows[0]?.text).toBe("id  uuid  PK");
    const fk = laidOut.nodes.find((n) => n.id === "@col:order-items/order-id");
    expect(fk?.text).toBe("order_id  uuid  FK");
    expect(laidOut.edges.find((e) => e.id === "items-order")?.label?.text).toBe(
      "order_id → id  N:1",
    );
  });

  test("a table of 200 columns lays out quickly", async () => {
    const board = load("overview-db");
    const wide = structuredClone(board);
    (wide.nodes[0] as { columns: unknown[] }).columns = Array.from({ length: 200 }, (_, i) => ({
      name: `column_${i}`,
      type: "text",
    }));
    const started = performance.now();
    const laidOut = await layoutBoard(wide);
    expect(
      laidOut.nodes.filter((n) => n.kind === "column" && n.screenId === "orders"),
    ).toHaveLength(200);
    expect(performance.now() - started).toBeLessThan(10_000);
  });

  test("a job is a card of its trigger and its retry policy", async () => {
    const laidOut = await layoutBoard(load("overview-batch"));
    const rows = (jobId: string) =>
      laidOut.nodes.filter((n) => n.kind === "row" && n.screenId === jobId).map((n) => n.text);
    expect(rows("send-receipt")).toEqual(["queue: send-receipt", "retry 3 (exponential)"]);
    expect(rows("close-stale-orders")).toEqual(["cron 0 2 * * *"]);
    expect(laidOut.nodes.find((n) => n.id === "send-receipt")?.shape).toBe("frame");
  });
});
