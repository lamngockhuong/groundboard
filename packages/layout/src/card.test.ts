import { readFileSync } from "node:fs";
import path from "node:path";
import { type Board, parseBoard } from "@groundboard/schema";
import { describe, expect, test } from "vitest";
import { endpointRowText, layoutCard } from "./card.ts";
import { layoutBoard } from "./layout.ts";

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
