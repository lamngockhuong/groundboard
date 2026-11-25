import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearEntries,
  type LibraryEntry,
  listEntries,
  removeEntry,
  saveEntries,
} from "../src/library.ts";
import { buildLibraryIndex, slugFor } from "../src/library-index.ts";
import { renderBoardLocally } from "../src/local-render.ts";
import { renderBoard } from "../src/render-client.ts";
import { loadSamples, SAMPLE_START } from "../src/samples.ts";

const board = (): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      path.resolve(import.meta.dirname, "../../../examples/checkout-flow.board.json"),
      "utf8",
    ),
  );

const entry = (slug: string, input: LibraryEntry["input"]): LibraryEntry => ({
  slug,
  input,
  openedAt: 1,
});

describe("slugFor", () => {
  it("names a board after its file, without the suffix", () => {
    expect(slugFor("overview-web.board.json", "Shop")).toBe("overview-web");
    expect(slugFor("flow.excalidraw", "x")).toBe("flow");
    expect(slugFor("Đặt hàng (v2).json", "x")).toBe("Dat-hang-v2");
  });

  it("names a pasted board after its title, and falls back to a fixed name", () => {
    expect(slugFor(undefined, "Place order: web")).toBe("Place-order-web");
    expect(slugFor(undefined, "…")).toBe("board");
    expect(slugFor("x".repeat(150), "t")).toHaveLength(100);
  });
});

describe("buildLibraryIndex", () => {
  it("indexes the samples like the server indexes an atlas, with their refs", async () => {
    const samples = await loadSamples();
    expect(samples.map((s) => s.slug)).toContain(SAMPLE_START);
    const index = buildLibraryIndex(samples);
    const kinds = Object.fromEntries(index.boards.map((b) => [b.slug, b.kind]));
    expect(kinds).toMatchObject({
      "overview-web": "overview",
      "web--checkout": "screen",
      "place-order": "flow",
    });
    expect(index.boards.every((b) => b.status === "ok")).toBe(true);
    const checkout = index.refs.find((r) => r.ref === "web:checkout");
    expect(checkout?.definedIn.map((p) => p.slug).sort()).toEqual([
      "overview-web",
      "web--checkout",
    ]);
  });

  it("lists an invalid board with its issues and a scene as a flow", () => {
    const index = buildLibraryIndex([
      entry("broken", { type: "board", board: { title: "Broken", nodes: "no" } }),
      entry("drawing", {
        type: "scene",
        title: "drawing.excalidraw",
        scene: { elements: [], appState: {}, files: {} },
      }),
    ]);
    expect(index.boards).toMatchObject([
      { slug: "broken", title: "Broken", status: "invalid" },
      { slug: "drawing", title: "drawing.excalidraw", kind: "flow", status: "ok" },
    ]);
    expect(index.boards[0]?.issues.length).toBeGreaterThan(0);
  });
});

describe("rendering in the browser", () => {
  it("renders every sample board to a scene marked as not checked", async () => {
    for (const sample of await loadSamples()) {
      if (sample.input.type !== "board") continue;
      const result = await renderBoardLocally(sample.input.board);
      expect(result.status, sample.slug).toBe("ok");
    }
  });

  it("returns the schema issues of an invalid board", async () => {
    const result = await renderBoard({ title: "x" });
    expect(result.status).toBe("invalid");
  });

  it("renders a valid board without a Worker, in the page", async () => {
    const result = await renderBoard(board());
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(Array.isArray(result.scene.elements)).toBe(true);
  });
});

describe("library storage", () => {
  it("keeps the list in memory when IndexedDB is unavailable", async () => {
    const a = entry("a", { type: "board", board: board() });
    expect(await saveEntries([a, entry("b", { type: "board", board: board() })])).toBe(false);
    expect((await listEntries()).map((e) => e.slug).sort()).toEqual(["a", "b"]);
    // The same slug replaces the earlier copy.
    await saveEntries([{ ...a, openedAt: 2 }]);
    expect((await listEntries()).find((e) => e.slug === "a")?.openedAt).toBe(2);
    await removeEntry("b");
    expect((await listEntries()).map((e) => e.slug)).toEqual(["a"]);
    await clearEntries();
    expect(await listEntries()).toEqual([]);
  });
});
