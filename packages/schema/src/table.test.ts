import { describe, expect, test } from "vitest";
import { boardKindOf, refsOf } from "./atlas-shape.ts";
import { boardClaims } from "./grounding.ts";
import { columnSlug, tableSlug } from "./table.ts";
import { parseBoard } from "./validate.ts";

const source = { id: "t", path: "db/schema.sql", line: 1, quote: "CREATE TABLE orders (" };
const table = (id: string, columns: Array<Record<string, unknown>>) => ({
  id,
  kind: "table",
  label: id,
  ref: `db:${id}`,
  sourceIds: ["t"],
  columns,
});
const board = (nodes: unknown[], edges: unknown[] = []) => ({
  schemaVersion: 1,
  title: "Database",
  question: "Which tables?",
  nodes,
  edges,
  sources: [source],
});
const messages = (input: unknown) => {
  const result = parseBoard(input);
  return result.ok ? [] : result.error.map((i) => `${i.path}: ${i.message}`);
};

describe("columnSlug and tableSlug", () => {
  test.each([
    ["customerId", "customer-id"],
    ["customer_id", "customer-id"],
    ["Customer ID", "customer-id"],
    ["created.at", "created-at"],
    ["HTTPStatus", "http-status"],
  ])("%s is %s", (name, slug) => {
    expect(columnSlug(name)).toBe(slug);
  });

  test("a table's slug is its name, lowercase, with hyphens", () => {
    expect(tableSlug("order_items")).toBe("order-items");
  });
});

describe("tables", () => {
  test("a table defines its ref and one for each column; a board of tables is a db board", () => {
    const parsed = parseBoard(
      board([table("orders", [{ name: "id", pk: true }, { name: "customerId" }])]),
    );
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (!parsed.ok) return;
    expect(boardKindOf(parsed.value)).toBe("db");
    expect(refsOf(parsed.value).defined.map((d) => d.ref)).toEqual([
      "db:orders",
      "db:orders/id",
      "db:orders/customer-id",
    ]);
    expect(boardClaims(parsed.value).map((c) => [c.id, c.grounding])).toEqual([["orders", "code"]]);
  });

  test("two columns with one slug, and columns on another kind, are refused", () => {
    expect(
      messages(board([table("orders", [{ name: "customerId" }, { name: "customer_id" }])])).join(
        " ",
      ),
    ).toContain("both give the ref slug `customer-id`");
    const step = {
      id: "s",
      kind: "step",
      label: "Step",
      sourceIds: ["t"],
      columns: [{ name: "x" }],
    };
    expect(messages(board([table("orders", []), step])).join(" ")).toContain(
      "columns is only allowed on `table` nodes",
    );
  });

  test("a foreign key names a column of each table, and is a claim", () => {
    const nodes = [table("orders", [{ name: "id" }]), table("items", [{ name: "order_id" }])];
    const fk = {
      id: "fk",
      from: "items",
      to: "orders",
      kind: "references",
      fromColumn: "order_id",
      toColumn: "id",
      sourceIds: ["t"],
    };
    expect(parseBoard(board(nodes, [fk])).ok).toBe(true);
    expect(messages(board(nodes, [{ ...fk, fromColumn: "nope" }])).join(" ")).toContain(
      "fromColumn `nope` is not a column of table `items`",
    );
    expect(messages(board(nodes, [{ ...fk, toColumn: "nope" }])).join(" ")).toContain(
      "toColumn `nope` is not a column of table `orders`",
    );
    expect(messages(board(nodes, [{ ...fk, sourceIds: [] }])).join(" ")).toContain(
      "cites no source that can back the foreign key",
    );
    expect(
      messages(
        board(nodes, [
          { id: "x", from: "items", to: "orders", kind: "flow", fromColumn: "order_id" },
        ]),
      ).join(" "),
    ).toContain("fromColumn is only allowed on references edges");
  });

  test("a write to a column on another board needs a db ref and a source", () => {
    const nodes = [{ id: "step", kind: "step", label: "Save", sourceIds: ["t"] }];
    expect(
      parseBoard(
        board(nodes, [
          { id: "w", from: "step", toRef: "db:orders/email", kind: "writes", sourceIds: ["t"] },
        ]),
      ).ok,
    ).toBe(true);
    expect(
      messages(
        board(nodes, [
          { id: "w", from: "step", toRef: "api:orders/post", kind: "writes", sourceIds: ["t"] },
        ]),
      ).join(" "),
    ).toContain("is in namespace api; writes targets a db ref");
    expect(
      messages(board(nodes, [{ id: "w", from: "step", toRef: "db:orders", kind: "reads" }])).join(
        " ",
      ),
    ).toContain("cites no source that can back it");
  });
});
