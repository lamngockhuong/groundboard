import { NODE_KINDS } from "@groundboard/schema";
import { describe, expect, it } from "vitest";
import { KIND_GROUPS, kindGroupsFor, suggestedRef } from "../src/node-kinds.ts";

const ids = (nodes: Array<Record<string, unknown>>) => kindGroupsFor(nodes).map((g) => g.id);

describe("KIND_GROUPS", () => {
  it("offers every node kind exactly once", () => {
    const listed = KIND_GROUPS.flatMap((g) => g.kinds);
    expect([...listed].sort()).toEqual([...NODE_KINDS].sort());
  });
});

describe("kindGroupsFor", () => {
  it("lists the flow group first on a flow board, and on an empty one", () => {
    expect(ids([{ kind: "step" }])).toEqual(["flow", "screen", "api", "db", "batch"]);
    expect(ids([])[0]).toBe("flow");
  });

  it("puts the group that fits the board first and keeps the rest in order", () => {
    expect(ids([{ kind: "resource" }, { kind: "endpoint" }])).toEqual([
      "api",
      "flow",
      "screen",
      "db",
      "batch",
    ]);
    expect(ids([{ kind: "table" }])[0]).toBe("db");
    expect(ids([{ kind: "job" }])[0]).toBe("batch");
  });

  it("treats an overview and a screen board as the screen group", () => {
    expect(ids([{ kind: "screen" }])[0]).toBe("screen");
    expect(ids([{ kind: "screen" }, { kind: "element" }])[0]).toBe("screen");
  });

  it("offers participants only on a sequence board, with the flow group's questions and notes", () => {
    expect(ids([{ kind: "participant" }, { kind: "note" }])).toEqual(["sequence", "flow"]);
    const groups = kindGroupsFor([{ kind: "participant" }]);
    expect(groups.flatMap((g) => g.kinds)).toEqual(["participant", "question", "note"]);
    expect(ids([{ kind: "step" }])).not.toContain("sequence");
  });

  it("ignores a node without a kind", () => {
    expect(ids([{ id: "x" }, { kind: "table" }])[0]).toBe("db");
  });
});

describe("suggestedRef", () => {
  it("makes the ref of each kind that defines one from its label", () => {
    expect(suggestedRef("table", "order_items", "web")).toBe("db:order-items");
    expect(suggestedRef("resource", "Orders", "web")).toBe("api:orders");
    expect(suggestedRef("job", "Send receipt", "web")).toBe("batch:send-receipt");
    expect(suggestedRef("screen", "Cart", "mobile")).toBe("mobile:cart");
  });

  it("drops Vietnamese marks rather than the letters that carry them", () => {
    expect(suggestedRef("table", "Đơn hàng", "web")).toBe("db:don-hang");
  });

  it("suggests nothing for a kind without such a ref, or a label without a letter", () => {
    expect(suggestedRef("step", "Pay", "web")).toBeNull();
    expect(suggestedRef("endpoint", "Get order", "web")).toBeNull();
    expect(suggestedRef("table", "  ", "web")).toBeNull();
  });
});
