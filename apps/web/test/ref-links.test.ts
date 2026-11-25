import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toAtlas } from "../src/api.ts";
import { boardDefiningRef } from "../src/atlas-nav.ts";
import type { LibraryEntry } from "../src/library.ts";
import { buildLibraryIndex } from "../src/library-index.ts";
import { renderBoardLocally } from "../src/local-render.ts";
import { selectedRefTarget } from "../src/sources.ts";

const atlasDir = path.resolve(import.meta.dirname, "../../../examples/fixtures/.groundboard");
const entries: LibraryEntry[] = readdirSync(atlasDir)
  .filter((name) => name.endsWith(".board.json"))
  .map((name) => ({
    slug: name.slice(0, -".board.json".length),
    input: { type: "board", board: JSON.parse(readFileSync(path.join(atlasDir, name), "utf8")) },
    openedAt: 1,
  }));

describe("links across boards in the library", () => {
  it("files the API board under its own group, with no problems in the fixture atlas", () => {
    const index = buildLibraryIndex(entries);
    expect(index.boards.find((b) => b.slug === "api--orders")?.kind).toBe("api");
    expect(index.problems).toEqual([]);
  });

  it("a double click on the Pay button's call tag opens the endpoint it calls", async () => {
    const checkout = entries.find((e) => e.slug === "web--checkout");
    if (checkout?.input.type !== "board") throw new Error("fixture");
    const result = await renderBoardLocally(checkout.input.board);
    if (result.status !== "ok") throw new Error(JSON.stringify(result));
    const elements = (result.scene as { elements: Array<{ id: string; customData?: unknown }> })
      .elements as never[];
    const tag = (elements as Array<{ id: string }>).find((e) => e.id === "ref-tag/pay-orders");
    expect(tag).toBeDefined();
    const ref = selectedRefTarget(elements, { [tag?.id as string]: true });
    expect(ref).toBe("api:orders/post");
    expect(boardDefiningRef(buildLibraryIndex(entries), ref as string)).toEqual({
      slug: "api--orders",
      nodeId: "create-order",
    });
  });

  it("a double click on POST /orders' write tag opens the orders table", async () => {
    const api = entries.find((e) => e.slug === "api--orders");
    if (api?.input.type !== "board") throw new Error("fixture");
    const result = await renderBoardLocally(api.input.board);
    if (result.status !== "ok") throw new Error(JSON.stringify(result));
    const elements = (result.scene as { elements: Array<{ id: string }> }).elements as never[];
    const ref = selectedRefTarget(elements, { "ref-tag/create-writes": true });
    expect(ref).toBe("db:orders");
    expect(boardDefiningRef(buildLibraryIndex(entries), ref as string)).toEqual({
      slug: "overview-db",
      nodeId: "orders",
    });
  });

  it("a column's row shows the column, its ref and its own source", async () => {
    const db = entries.find((e) => e.slug === "overview-db");
    if (db?.input.type !== "board") throw new Error("fixture");
    const result = await renderBoardLocally(db.input.board);
    if (result.status !== "ok") throw new Error(JSON.stringify(result));
    const elements = (result.scene as { elements: Array<{ id: string }> }).elements as never[];
    const { nodeCitations } = await import("../src/sources.ts");
    const row = (elements as Array<{ id: string }>).find((e) => e.id === "node/@col:orders/email");
    expect(nodeCitations(row as never)).toMatchObject({
      nodeId: "orders",
      column: "email",
      ref: "db:orders/email",
      sources: [{ id: "orders-email" }],
    });
  });

  it("follows the Pay button through the API to the table it writes and the job it starts", async () => {
    const index = buildLibraryIndex(entries);
    const follow = async (slug: string, tag: string) => {
      const entry = entries.find((e) => e.slug === slug);
      if (entry?.input.type !== "board") throw new Error(slug);
      const result = await renderBoardLocally(entry.input.board);
      if (result.status !== "ok") throw new Error(JSON.stringify(result));
      const elements = (result.scene as { elements: unknown[] }).elements as never[];
      const ref = selectedRefTarget(elements, { [`ref-tag/${tag}`]: true });
      return ref === null ? null : boardDefiningRef(index, ref);
    };
    expect(await follow("web--checkout", "pay-orders")).toEqual({
      slug: "api--orders",
      nodeId: "create-order",
    });
    expect(await follow("api--orders", "create-writes")).toEqual({
      slug: "overview-db",
      nodeId: "orders",
    });
    expect(await follow("api--orders", "create-enqueues")).toEqual({
      slug: "overview-batch",
      nodeId: "send-receipt",
    });
  });

  it("reports a ref no board defines, as the server does", () => {
    const broken = structuredClone(entries);
    const checkout = broken.find((e) => e.slug === "web--checkout");
    if (checkout?.input.type !== "board") throw new Error("fixture");
    const edges = checkout.input.board.edges as Array<Record<string, unknown>>;
    (edges.find((e) => e.id === "pay-orders") as Record<string, unknown>).toRef = "api:orders/gone";
    const index = buildLibraryIndex(broken);
    expect(index.problems.map((p) => p.path)).toEqual(["api:orders/gone"]);
  });

  it("does not take an unknown board kind from the server for a flow", () => {
    const atlas = toAtlas({
      boards: [{ slug: "x", title: "X", kind: "graphql", status: "ok" }],
      refs: [],
      problems: [],
    });
    expect(atlas?.boards[0]).toMatchObject({ status: "invalid" });
    expect(atlas?.boards[0]?.issues[0]?.message).toContain("graphql");
  });
});
