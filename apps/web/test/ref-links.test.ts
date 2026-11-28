import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toAtlas } from "../src/api.ts";
import { boardDefiningRef } from "../src/atlas-nav.ts";
import type { LibraryEntry } from "../src/library.ts";
import { buildLibraryIndex } from "../src/library-index.ts";
import { renderBoardLocally } from "../src/local-render.ts";
import { selectedCitations, selectedRefTarget } from "../src/sources.ts";

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
      label: "Place an order",
    });
  });

  it("a double click on POST /orders' write tag opens the orders table", async () => {
    const api = entries.find((e) => e.slug === "api--orders");
    if (api?.input.type !== "board") throw new Error("fixture");
    const result = await renderBoardLocally(api.input.board);
    if (result.status !== "ok") throw new Error(JSON.stringify(result));
    const elements = (result.scene as { elements: Array<{ id: string }> }).elements as never[];
    const ref = selectedRefTarget(elements, { "row-tag/create-writes": true });
    expect(ref).toBe("db:orders");
    expect(boardDefiningRef(buildLibraryIndex(entries), ref as string)).toEqual({
      slug: "overview-db",
      nodeId: "orders",
      label: "orders",
    });
  });

  it("an endpoint lists its guards and the tables and jobs it touches, each with its source", async () => {
    const api = entries.find((e) => e.slug === "api--orders");
    if (api?.input.type !== "board") throw new Error("fixture");
    const result = await renderBoardLocally(api.input.board);
    if (result.status !== "ok") throw new Error(JSON.stringify(result));
    const elements = (result.scene as { elements: Array<{ id: string }> }).elements as never[];
    const [endpoint] = selectedCitations(elements, { "node/create-order": true });
    expect(endpoint?.guards).toEqual([]);
    expect(endpoint?.dataEdges).toMatchObject([
      {
        edgeId: "create-writes",
        kind: "writes",
        toRef: "db:orders",
        sources: [{ id: "insert-order" }],
      },
      { edgeId: "create-enqueues", kind: "enqueues", toRef: "batch:send-receipt" },
    ]);
    // A tag selects its edge, named by the endpoint it starts from.
    const [tag] = selectedCitations(elements, { "row-tag/create-writes/text": true });
    expect(tag).toMatchObject({
      edgeId: "create-writes",
      toRef: "db:orders",
      fromLabel: expect.any(String),
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
    const follow = async (slug: string, elementId: string) => {
      const entry = entries.find((e) => e.slug === slug);
      if (entry?.input.type !== "board") throw new Error(slug);
      const result = await renderBoardLocally(entry.input.board);
      if (result.status !== "ok") throw new Error(JSON.stringify(result));
      const elements = (result.scene as { elements: unknown[] }).elements as never[];
      const ref = selectedRefTarget(elements, { [elementId]: true });
      return ref === null ? null : boardDefiningRef(index, ref);
    };
    expect(await follow("web--checkout", "ref-tag/pay-orders")).toEqual({
      slug: "api--orders",
      nodeId: "create-order",
      label: "Place an order",
    });
    expect(await follow("api--orders", "row-tag/create-writes")).toEqual({
      slug: "overview-db",
      nodeId: "orders",
      label: "orders",
    });
    expect(await follow("api--orders", "row-tag/create-enqueues")).toEqual({
      slug: "overview-batch",
      nodeId: "send-receipt",
      label: "Send the receipt",
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

describe("a sequence board in the viewer", () => {
  const scene = async () => {
    const { sequenceBoard } = await import("../../../packages/schema/test/sequence-board.ts");
    const result = await renderBoardLocally(sequenceBoard());
    if (result.status !== "ok") throw new Error(JSON.stringify(result));
    return (result.scene as { elements: Array<{ id: string }> }).elements as never[];
  };

  it("a message reads its number, its type, its two participants and its neighbours", async () => {
    const elements = await scene();
    const [message] = selectedCitations(elements, { "edge-label/m2": true });
    expect(message).toMatchObject({
      edgeId: "m2",
      kind: "message",
      number: 2,
      messageType: "sync",
      label: "2. authorize(amount)",
      fromLabel: "Orders API",
      toLabel: "Payment gateway",
      previousId: "m1",
      nextId: "m3",
      sources: [{ id: "auth" }],
    });
    const [first] = selectedCitations(elements, { "edge/m1": true });
    expect(first?.previousId).toBeUndefined();
    expect(first?.ref).toBe("api:orders/post");
  });

  it("a guard selects its operand, with its fragment's kind and its condition's source", async () => {
    const elements = await scene();
    const [operand] = selectedCitations(elements, { "operand-guard/declined": true });
    expect(operand).toMatchObject({
      nodeId: "declined",
      operandId: "declined",
      fragmentKind: "alt",
      fragmentId: "pay",
      guard: "declined",
      sources: [{ id: "if-ok" }],
      grounding: "code",
    });
    const [tag] = selectedCitations(elements, { "fragment-tag/lines/text": true });
    expect(tag).toMatchObject({ operandId: "each", fragmentKind: "loop" });
  });

  it("a participant reads its category and its label", async () => {
    const elements = await scene();
    const [bank] = selectedCitations(elements, { "node/bank/caption": true });
    expect(bank).toMatchObject({
      nodeId: "bank",
      kind: "participant",
      category: "external",
      label: "Payment gateway",
    });
  });

  it("a double click on a message or a participant with a ref opens what it reaches", async () => {
    const elements = await scene();
    expect(selectedRefTarget(elements, { "edge/m4": true, "edge-label/m4": true })).toBe(
      "db:orders",
    );
    expect(selectedRefTarget(elements, { "node/q": true, "node/q/text": true })).toBe(
      "batch:send-receipt",
    );
    expect(selectedRefTarget(elements, { "edge/m2": true })).toBeNull();
  });

  it("lists the participants and the messages for the palette, and reaches a message by id", async () => {
    const { boardNodes, elementForNode } = await import("../src/sources.ts");
    const elements = await scene();
    const nodes = boardNodes(elements);
    expect(nodes.filter((n) => n.kind === "message").map((n) => n.label)).toContain(
      "2. authorize(amount)",
    );
    expect(nodes.find((n) => n.nodeId === "bank")?.label).toBe("Payment gateway");
    expect(elementForNode(elements, "m2")?.id).toBe("edge/m2");
  });
});
