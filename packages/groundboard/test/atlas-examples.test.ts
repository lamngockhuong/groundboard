// The committed screen atlas example: every board valid with checked sources, the atlas clean,
// each overview listing exactly the expected screens, and each screen board the expected tree.
// These check what is committed; whether an agent saw everything on a real screenshot is
// accepted by hand.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type Board, lintBoardText, parseBoard } from "@groundboard/schema";
import { describe, expect, test } from "vitest";
import { buildAtlas } from "../src/atlas.ts";
import { validateBoard } from "../src/pipeline.ts";

const fixtures = path.resolve(import.meta.dirname, "../../../examples/fixtures");
const atlasDir = path.join(fixtures, ".groundboard");
const expected = JSON.parse(readFileSync(path.join(fixtures, "expected-atlas.json"), "utf8")) as {
  screens: Record<string, string[]>;
  screenBoards: Record<string, Tree[]>;
  /** Each API board's endpoint refs, and the calls the screens make to them. */
  apis: Record<string, string[]>;
  calls: Record<string, string[]>;
  tables: Record<string, string[]>;
  jobs: Record<string, string[]>;
};
const names = readdirSync(atlasDir).filter((n) => n.endsWith(".board.json"));

interface Tree {
  role: string;
  children?: Tree[];
}

function load(slug: string): Board {
  const result = parseBoard(
    JSON.parse(readFileSync(path.join(atlasDir, `${slug}.board.json`), "utf8")),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

/** The element tree under the board's screen: roles in board order. */
function treeOf(board: Board): Tree[] {
  const screen = board.nodes.find((n) => n.kind === "screen");
  const under = (parentId: string | undefined): Tree[] =>
    board.nodes
      .filter((n) => n.kind === "element" && n.parentId === parentId)
      .map((n) => {
        const children = under(n.id);
        return children.length > 0
          ? { role: n.role as string, children }
          : { role: n.role as string };
      });
  return under(screen?.id);
}

describe("examples/fixtures/.groundboard", () => {
  test("holds the expected boards", () => {
    expect(names.sort()).toEqual([
      "api--orders.board.json",
      "mobile--cart.board.json",
      "overview-batch.board.json",
      "overview-db.board.json",
      "overview-mobile.board.json",
      "overview-web.board.json",
      "place-order.board.json",
      "web--checkout.board.json",
    ]);
  });

  test.each(names)(
    "%s is valid, its sources check out, and it has no data warnings",
    async (name) => {
      const input = JSON.parse(readFileSync(path.join(atlasDir, name), "utf8"));
      const result = await validateBoard(input, { checkSourcesRoot: fixtures });
      expect(result.issues).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(lintBoardText(result.board as Board)).toEqual([]);
    },
  );

  test("the atlas has no problem", async () => {
    const atlas = await buildAtlas(atlasDir, fixtures);
    expect(atlas.problems).toEqual([]);
    expect(atlas.boards.map((b) => b.status)).toEqual(names.map(() => "ok"));
  });

  test.each(Object.entries(expected.screens))(
    "%s defines exactly the expected screens",
    (slug, refs) => {
      const board = load(slug);
      const defined = board.nodes
        .filter((n) => n.kind === "screen")
        .map((n) => n.ref)
        .sort();
      expect(defined).toEqual(refs);
      for (const edge of board.edges.filter((e) => e.kind === "navigates")) {
        const cited = edge.sourceIds.map((id) => board.sources.find((s) => s.id === id));
        expect(
          cited.some((s) => s?.kind === "code" && s.quote),
          edge.id,
        ).toBe(true);
      }
    },
  );

  test.each(Object.entries(expected.screenBoards))(
    "%s has the expected element tree",
    (slug, tree) => {
      expect(treeOf(load(slug))).toEqual(tree);
    },
  );

  test("no board stores a screenshot path or an image", () => {
    for (const name of names) {
      const text = readFileSync(path.join(atlasDir, name), "utf8");
      expect(text, name).not.toMatch(/\.(png|jpe?g|webp|heic)\b|data:image|\/tmp\/|\/home\//i);
    }
  });

  test.each(Object.entries(expected.apis))(
    "%s defines exactly the expected endpoints",
    (slug, refs) => {
      const board = load(slug);
      const defined = board.nodes.filter((n) => n.kind === "endpoint").map((n) => n.ref);
      expect(defined.sort()).toEqual([...refs].sort());
    },
  );

  test.each(Object.entries(expected.calls))(
    "%s calls exactly the expected endpoints",
    (slug, refs) => {
      const board = load(slug);
      const called = board.edges.filter((e) => e.kind === "calls").map((e) => e.toRef ?? e.to);
      expect(called.sort()).toEqual([...refs].sort());
    },
  );

  test.each(Object.entries(expected.tables))(
    "%s defines exactly the expected tables",
    (slug, refs) => {
      const board = load(slug);
      const defined = board.nodes.filter((n) => n.kind === "table").map((n) => n.ref);
      expect(defined.sort()).toEqual([...refs].sort());
    },
  );

  test.each(Object.entries(expected.jobs))("%s defines exactly the expected jobs", (slug, refs) => {
    const board = load(slug);
    const defined = board.nodes.filter((n) => n.kind === "job").map((n) => n.ref);
    expect(defined.sort()).toEqual([...refs].sort());
  });

  test("the served atlas leads from the Pay button to the endpoint, its table and its job", async () => {
    const atlas = await buildAtlas(atlasDir, fixtures);
    const definer = (ref: string) => atlas.refs.find((r) => r.ref === ref)?.definedIn[0];
    const used = (ref: string) => atlas.refs.find((r) => r.ref === ref)?.usedIn;
    expect(used("api:orders/post")).toEqual([
      { slug: "web--checkout", nodeId: "pay", edgeId: "pay-orders" },
    ]);
    expect(definer("api:orders/post")).toMatchObject({
      slug: "api--orders",
      nodeId: "create-order",
    });
    expect(used("db:orders")?.map((u) => u.edgeId)).toContain("create-writes");
    expect(definer("db:orders")).toMatchObject({ slug: "overview-db", nodeId: "orders" });
    expect(used("batch:send-receipt")).toEqual([
      { slug: "api--orders", nodeId: "create-order", edgeId: "create-enqueues" },
    ]);
    expect(definer("batch:send-receipt")).toMatchObject({
      slug: "overview-batch",
      nodeId: "send-receipt",
    });
  });
});
