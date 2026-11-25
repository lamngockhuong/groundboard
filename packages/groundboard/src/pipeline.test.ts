import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { renderBoard, SOURCES_NOT_CHECKED, validateBoard } from "./pipeline.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const load = (name: string) =>
  JSON.parse(readFileSync(path.join(repoRoot, "examples", `${name}.board.json`), "utf8"));

/**
 * The two examples cite their design notes (`decisions.md`, `README.md`) as code sources, from
 * before doc sources existed; the examples are kept unchanged, so they carry this warning.
 */
const DOC_AS_CODE = /cites a document as code/;
const otherWarnings = (warnings: string[]) => warnings.filter((w) => !DOC_AS_CODE.test(w));

const statusOf = (scene: { elements: Array<{ id: string; text?: string }> } | undefined) =>
  scene?.elements.find((e) => e.id === "title-status")?.text;

describe("renderBoard", () => {
  test.each(["checkout-flow", "order-state-machine"])(
    "renders %s with checked sources",
    async (name) => {
      const result = await renderBoard(load(name), { checkSourcesRoot: repoRoot });
      expect(result.issues).toEqual([]);
      expect(result.ok).toBe(true);
      expect(otherWarnings(result.warnings)).toEqual([]);
      expect(result.warnings.some((w) => DOC_AS_CODE.test(w))).toBe(true);
      expect(result.sourcesChecked).toEqual({ root: "working tree" });
      expect(statusOf(result.scene)).toBe("Sources checked against the working tree");
    },
  );

  test("warns and says so on the board when sources are not checked", async () => {
    const result = await renderBoard(load("checkout-flow"));
    expect(result.ok).toBe(true);
    expect(otherWarnings(result.warnings)).toEqual([SOURCES_NOT_CHECKED]);
    expect(statusOf(result.scene)).toBe("Sources NOT checked");
  });

  test("returns issues and no scene for an invalid board", async () => {
    const board = load("checkout-flow");
    board.edges[0].to = "missing";
    const result = await renderBoard(board);
    expect(result.ok).toBe(false);
    expect(result.scene).toBeUndefined();
    expect(result.issues).toEqual([
      { path: "edges[0].to", message: "edge `e1` to `missing`, which is not a node id" },
    ]);
  });

  test("returns issues and no scene when a quote does not match", async () => {
    const board = load("checkout-flow");
    board.sources[0].quote = "not in the file";
    const result = await renderBoard(board, { checkSourcesRoot: repoRoot });
    expect(result.ok).toBe(false);
    expect(result.scene).toBeUndefined();
    expect(result.issues.map((i) => i.path)).toEqual(["sources[0].quote"]);
  });

  test("draws a stale board when asked, marked unchecked and reported stale", async () => {
    const board = load("checkout-flow");
    board.sources[0].quote = "not in the file";
    const result = await renderBoard(board, {
      checkSourcesRoot: repoRoot,
      onStaleSources: "render",
    });
    expect(result.ok).toBe(true);
    expect(result.stale).toBe(true);
    expect(result.staleIssues?.map((i) => i.path)).toEqual(["sources[0].quote"]);
    expect(result.sourcesChecked).toBeNull();
    expect(statusOf(result.scene)).toBe("Sources NOT checked");
  });

  test("never draws a board that fails the schema, even with onStaleSources render", async () => {
    const board = load("checkout-flow");
    board.edges[0].to = "missing";
    const result = await renderBoard(board, {
      checkSourcesRoot: repoRoot,
      onStaleSources: "render",
    });
    expect(result.ok).toBe(false);
    expect(result.scene).toBeUndefined();
  });

  test("passes warnings about text that looks like real data", async () => {
    const board = load("checkout-flow");
    board.nodes[0].label = "Email receipt to jane@example.com";
    const result = await renderBoard(board, { checkSourcesRoot: repoRoot });
    expect(result.ok).toBe(true);
    expect(otherWarnings(result.warnings)).toEqual([
      expect.stringMatching(/^nodes\[0\]\.label .*email address/),
    ]);
  });

  test("rejects an unknown output format", async () => {
    const result = await renderBoard(load("checkout-flow"), { to: "figjam" as "excalidraw" });
    expect(result.issues[0]?.message).toMatch(/unknown output format/);
  });

  test("lays out in a worker when asked, with the same scene", async () => {
    const [inline, worker] = await Promise.all([
      renderBoard(load("order-state-machine")),
      renderBoard(load("order-state-machine"), { workerTimeoutMs: 20_000 }),
    ]);
    expect(worker.scene).toEqual(inline.scene);
  }, 30_000);
});

describe("validateBoard", () => {
  test("passes the example with checked sources", async () => {
    const result = await validateBoard(load("order-state-machine"), { checkSourcesRoot: repoRoot });
    expect(result.ok).toBe(true);
  });
});
