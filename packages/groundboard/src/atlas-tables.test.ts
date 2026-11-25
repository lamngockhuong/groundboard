import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildAtlas } from "./atlas.ts";

let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "atlas-tables-"));
  dir = path.join(root, ".groundboard");
  mkdirSync(dir);
  mkdirSync(path.join(root, "db"));
  writeFileSync(
    path.join(root, "db", "schema.sql"),
    ["CREATE TABLE orders (", "  id uuid PRIMARY KEY,", "  email text NOT NULL", ");"].join("\n"),
  );
  mkdirSync(path.join(root, "server"));
  writeFileSync(
    path.join(root, "server", "routes.ts"),
    'router.post("/orders", async () => {});\ndb.insert("orders", row);\n',
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const tables = (
  columns = [
    { name: "id", type: "uuid", pk: true },
    { name: "email", type: "text" },
  ],
) => ({
  schemaVersion: 1,
  title: "Database",
  question: "Which tables?",
  nodes: [
    { id: "orders", kind: "table", label: "orders", ref: "db:orders", sourceIds: ["t"], columns },
  ],
  sources: [{ id: "t", path: "db/schema.sql", line: 1, quote: "CREATE TABLE orders (" }],
});

const api = (toRef: string) => ({
  schemaVersion: 1,
  title: "Orders API",
  question: "Which endpoints?",
  nodes: [
    { id: "orders", kind: "resource", label: "Orders", ref: "api:orders" },
    {
      id: "create",
      kind: "endpoint",
      label: "Create",
      parentId: "orders",
      method: "POST",
      path: "/orders",
      ref: "api:orders/post",
      sourceIds: ["r"],
    },
  ],
  edges: [{ id: "w", from: "create", toRef, kind: "writes", sourceIds: ["q"] }],
  sources: [
    { id: "r", path: "server/routes.ts", line: 1, quote: 'router.post("/orders"' },
    { id: "q", path: "server/routes.ts", line: 2, quote: 'db.insert("orders", row);' },
  ],
});

const write = (name: string, board: unknown) =>
  writeFileSync(path.join(dir, name), JSON.stringify(board));

describe("tables in the atlas", () => {
  test("a table and its columns define refs a write elsewhere points at", async () => {
    write("overview-db.board.json", tables());
    write("api--orders.board.json", api("db:orders/email"));
    const atlas = await buildAtlas(dir, root);
    expect(atlas.problems).toEqual([]);
    expect(atlas.boards.find((b) => b.slug === "overview-db.board.json".slice(0, -11))?.kind).toBe(
      "db",
    );
    const email = atlas.refs.find((r) => r.ref === "db:orders/email");
    expect(email?.definedIn).toEqual([{ slug: "overview-db", nodeId: "orders", kind: "table" }]);
    expect(email?.usedIn).toEqual([{ slug: "api--orders", nodeId: "create", edgeId: "w" }]);
  });

  test("a column ref no table has is dangling", async () => {
    write("overview-db.board.json", tables());
    write("api--orders.board.json", api("db:orders/missing-column"));
    const atlas = await buildAtlas(dir, root);
    expect(atlas.problems).toEqual([
      {
        path: "db:orders/missing-column",
        message:
          "ref `db:orders/missing-column` is used in api--orders (create) but no board defines it",
      },
    ]);
  });

  test("dropping a column another board points at shows in the baseline check", async () => {
    const baseline = path.join(root, ".groundboard-baseline");
    mkdirSync(baseline);
    writeFileSync(path.join(baseline, "overview-db.board.json"), JSON.stringify(tables()));
    write("overview-db.board.json", tables([{ name: "id", type: "uuid", pk: true }]));
    const atlas = await buildAtlas(dir, root, { baselineDir: baseline });
    expect(atlas.problems).toEqual([
      {
        path: "overview-db.board.json",
        message: "ref(s) in the baseline are gone: `db:orders/email`",
      },
    ]);
  });

  test("a default that looks like a URL with a password is a warning", async () => {
    write(
      "overview-db.board.json",
      tables([
        { name: "dsn", type: "text", default: "postgres://admin:s3cret@db.internal/app" } as never,
      ]),
    );
    const atlas = await buildAtlas(dir, root);
    expect(atlas.boards[0]?.warnings.join(" ")).toContain("a URL with a password");
  });
});
