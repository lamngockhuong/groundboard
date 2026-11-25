import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBoardsZip } from "../src/download.ts";
import type { LibraryEntry } from "../src/library.ts";
import { readBoardZip } from "../src/zip.ts";

const boardText = readFileSync(
  path.resolve(import.meta.dirname, "../../../examples/checkout-flow.board.json"),
  "utf8",
);
const scene = { elements: [{ id: "a", type: "rectangle" }], appState: {}, files: {} };

afterEach(() => vi.unstubAllGlobals());

/** Answers `data/boards/<slug>.json` of an exported page from `boards`. */
function stubExport(boards: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const slug = /data\/boards\/(.+)\.json$/.exec(url)?.[1] ?? "";
      const body = boards[slug];
      return body === undefined
        ? new Response("{}", { status: 404 })
        : new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

describe("buildBoardsZip", () => {
  it("packs an exported page's embedded board files, and names the invalid ones", async () => {
    stubExport({
      ok: { scene: { type: "excalidraw", ...scene }, status: "ok", source: boardText },
      bad: { status: "invalid", issues: [], source: '{"schemaVersion":1}' },
      old: { scene: { type: "excalidraw", ...scene }, status: "ok" },
    });
    const progress: number[] = [];
    const result = await buildBoardsZip(
      { kind: "static", slugs: ["ok", "bad", "old"] },
      { extras: false, onProgress: (done) => progress.push(done) },
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(progress).toEqual([1, 2, 3]);
    const read = readBoardZip(result.zip);
    expect(read.ok && read.boards.map((b) => [b.slug, b.text])).toEqual([["ok", boardText]]);
    expect(read.ok && read.rejected.map((r) => r.name)).toEqual([".groundboard/bad.board.json"]);
  });

  it("adds scenes and images with extras", async () => {
    stubExport({
      ok: { scene: { type: "excalidraw", ...scene }, status: "ok", source: boardText },
    });
    const result = await buildBoardsZip(
      { kind: "static", slugs: ["ok"] },
      { extras: true, toImage: async () => new Uint8Array([1, 2, 3]) },
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const { unzipSync, strFromU8 } = await import("fflate");
    const files = unzipSync(result.zip);
    expect(Object.keys(files).sort()).toEqual([
      ".groundboard/ok.board.json",
      ".groundboard/ok.excalidraw",
      "images/ok.png",
    ]);
    expect(JSON.parse(strFromU8(files[".groundboard/ok.excalidraw"] as Uint8Array)).type).toBe(
      "excalidraw",
    );
  });

  it("packs the library so that it reads back to the same boards and scenes", async () => {
    const entries: LibraryEntry[] = [
      { slug: "checkout", input: { type: "board", board: JSON.parse(boardText) }, openedAt: 1 },
      { slug: "sketch", input: { type: "scene", scene, title: "sketch.excalidraw" }, openedAt: 1 },
    ];
    const result = await buildBoardsZip(
      { kind: "library", entries },
      {
        extras: true,
        render: async () => ({ error: "boom" }),
        toImage: async () => new Uint8Array(),
      },
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const read = readBoardZip(result.zip);
    expect(read.ok && read.boards.map((b) => [b.slug, JSON.parse(b.text)])).toEqual([
      ["checkout", JSON.parse(boardText)],
    ]);
    expect(read.ok && read.scenes.map((s) => s.slug)).toEqual(["sketch"]);
    const { unzipSync, strFromU8 } = await import("fflate");
    expect(strFromU8(unzipSync(result.zip)["errors.txt"] as Uint8Array)).toBe(
      "checkout.board.json: not rendered (boom)\n",
    );
  });

  it("puts the drafts kept in this browser in place of the files they were made from", async () => {
    stubExport({
      ok: {
        scene: { type: "excalidraw", ...scene },
        status: "ok",
        source: boardText,
        overlay: '{"schemaVersion":1,"nodes":{},"notes":[]}',
      },
    });
    const draftOverlay = { schemaVersion: 1, nodes: { "n-ready": { dx: 5, dy: 0 } }, notes: [] };
    const result = await buildBoardsZip(
      {
        kind: "static",
        slugs: ["ok"],
        drafts: [
          {
            key: "a:ok",
            atlasId: "a",
            slug: "ok",
            baseEtag: "x",
            overlay: draftOverlay,
            savedAt: 1,
          },
        ],
      },
      { extras: false },
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const read = readBoardZip(result.zip);
    expect(read.ok && read.overlays.map((o) => o.overlay)).toEqual([draftOverlay]);
  });

  it("stops when the signal aborts", async () => {
    stubExport({ ok: { status: "ok", source: boardText, scene } });
    const abort = new AbortController();
    abort.abort();
    await expect(
      buildBoardsZip({ kind: "static", slugs: ["ok"] }, { extras: false, signal: abort.signal }),
    ).rejects.toThrow(/aborted/);
  });
});
