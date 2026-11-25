import { readFileSync } from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  isUnsafeName,
  MAX_ATLAS_BOARDS,
  MAX_BOARD_FILE_BYTES,
  MAX_ZIP_BYTES,
  readBoardZip,
  writeBoardZip,
  zipPaths,
} from "../src/zip.ts";

const boardText = readFileSync(
  path.resolve(import.meta.dirname, "../../../examples/checkout-flow.board.json"),
  "utf8",
);

const scene = (elements: unknown[] = [{ id: "a", type: "rectangle" }]) =>
  JSON.stringify({ type: "excalidraw", version: 2, elements, appState: {}, files: { f: {} } });

const zipOf = (files: Record<string, string | Uint8Array>, level: 0 | 6 = 6) =>
  zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, data]) => [
        name,
        typeof data === "string" ? strToU8(data) : data,
      ]),
    ),
    { level },
  );

describe("isUnsafeName", () => {
  it("refuses names that could leave the folder they are unpacked into", () => {
    for (const name of ["/etc/x.board.json", "C:/x", "a/../b", "..", "a\\b", "a\0b"]) {
      expect(isUnsafeName(name)).toBe(true);
    }
    for (const name of [".groundboard/x.board.json", "x..y.board.json", "images/a.svg"]) {
      expect(isUnsafeName(name)).toBe(false);
    }
  });
});

describe("readBoardZip", () => {
  it("reads boards and scenes at the root and under .groundboard/", () => {
    const read = readBoardZip(
      zipOf({
        ".groundboard/checkout.board.json": boardText,
        "root.board.json": boardText,
        ".groundboard/sketch.excalidraw": scene(),
      }),
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.boards.map((b) => b.slug)).toEqual(["checkout", "root"]);
    expect(read.boards[0]?.text).toBe(boardText);
    expect(read.scenes.map((s) => s.slug)).toEqual(["sketch"]);
    expect(read.rejected).toEqual([]);
  });

  it("refuses a zip with an unsafe entry name, whole", () => {
    for (const name of ["../evil.board.json", "/abs.board.json", "a\\b.board.json"]) {
      const read = readBoardZip(zipOf({ "ok.board.json": boardText, [name]: boardText }));
      expect(read).toEqual({ ok: false, problem: { code: "unsafe-name", name } });
    }
  });

  it("refuses more boards than an atlas reads", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i <= MAX_ATLAS_BOARDS; i += 1) files[`b${i}.board.json`] = "{}";
    const read = readBoardZip(zipOf(files));
    expect(read).toEqual({
      ok: false,
      problem: { code: "too-many-boards", limit: MAX_ATLAS_BOARDS },
    });
  });

  it("refuses a file larger than a board may be", () => {
    const big = new Uint8Array(MAX_BOARD_FILE_BYTES + 1).fill(32);
    const read = readBoardZip(zipOf({ "big.board.json": big }, 0));
    expect(read).toEqual({
      ok: false,
      problem: { code: "file-too-large", name: "big.board.json", limit: MAX_BOARD_FILE_BYTES },
    });
  });

  it("refuses a zip that unpacks to more than the total limit", () => {
    const chunk = new Uint8Array(MAX_BOARD_FILE_BYTES - 1).fill(32);
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < MAX_ZIP_BYTES / MAX_BOARD_FILE_BYTES + 1; i += 1) {
      files[`b${i}.board.json`] = chunk;
    }
    const read = readBoardZip(zipOf(files, 0));
    expect(read).toEqual({ ok: false, problem: { code: "too-large", limit: MAX_ZIP_BYTES } });
  });

  it("refuses a file that claims an unusual compression ratio", () => {
    // A megabyte of one byte deflates to about a kilobyte: a ratio near 1000:1.
    const read = readBoardZip(zipOf({ "bomb.board.json": new Uint8Array(1024 * 1024).fill(32) }));
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.problem.code).toBe("ratio");
  });

  it("refuses bytes that are not a zip", () => {
    expect(readBoardZip(strToU8("not a zip"))).toEqual({ ok: false, problem: { code: "not-zip" } });
  });

  it("rejects an invalid board on its own and loads the others", () => {
    const read = readBoardZip(
      zipOf({
        "good.board.json": boardText,
        "bad.board.json": JSON.stringify({ schemaVersion: 1, title: "x" }),
        "broken.board.json": "{ nope",
      }),
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.boards.map((b) => b.slug)).toEqual(["good"]);
    expect(read.rejected.map((r) => [r.name, r.reason])).toEqual([
      ["bad.board.json", "invalid-board"],
      ["broken.board.json", "not-json"],
    ]);
    expect(read.rejected[0]?.detail).toBeTruthy();
  });

  it("keeps the board and skips a scene of the same slug", () => {
    const read = readBoardZip(
      zipOf({
        [zipPaths.board("checkout")]: boardText,
        [zipPaths.scene("checkout")]: scene(),
      }),
    );
    expect(read.ok && read.boards.map((b) => b.slug)).toEqual(["checkout"]);
    expect(read.ok && read.scenes).toEqual([]);
    expect(read.ok && read.skipped).toEqual([
      { name: ".groundboard/checkout.excalidraw", reason: "scene-shadowed" },
    ]);
  });

  it("drops a scene's files and its image, embeddable and iframe elements", () => {
    const read = readBoardZip(
      zipOf({
        "s.excalidraw": scene([
          { id: "a", type: "rectangle" },
          { id: "b", type: "image", fileId: "f" },
          { id: "c", type: "embeddable" },
          { id: "d", type: "iframe" },
        ]),
      }),
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.scenes[0]?.scene.files).toEqual({});
    expect(read.scenes[0]?.scene.elements).toEqual([{ id: "a", type: "rectangle" }]);
  });

  it("skips images, errors.txt and other files with a note, and folders silently", () => {
    const read = readBoardZip(
      zipOf({
        "a.board.json": boardText,
        "images/a.svg": "<svg/>",
        "errors.txt": "x: failed",
        "notes.md": "hi",
        "deep/dir/x.board.json": boardText,
      }),
    );
    expect(read.ok && read.skipped.map((s) => [s.name, s.reason])).toEqual([
      ["images/a.svg", "image"],
      ["notes.md", "not-board"],
      ["deep/dir/x.board.json", "not-board"],
    ]);
  });

  it("keeps one board when the root and .groundboard/ both have it", () => {
    const read = readBoardZip(
      zipOf({ "a.board.json": boardText, ".groundboard/a.board.json": boardText }),
    );
    expect(read.ok && read.boards.length).toBe(1);
    expect(read.ok && read.skipped).toEqual([{ name: "a.board.json", reason: "duplicate" }]);
  });
});

describe("readBoardZip overlays", () => {
  const overlay = JSON.stringify({ schemaVersion: 1, nodes: { a: { dx: 1, dy: 2 } }, notes: [] });

  it("reads the overlay of a board in the same zip, and skips one without its board", () => {
    const read = readBoardZip(
      zipOf({
        [zipPaths.board("checkout")]: boardText,
        [zipPaths.overlay("checkout")]: overlay,
        [zipPaths.overlay("ghost")]: overlay,
      }),
    );
    expect(read.ok && read.overlays.map((o) => [o.slug, o.overlay.nodes])).toEqual([
      ["checkout", { a: { dx: 1, dy: 2 } }],
    ]);
    expect(read.ok && read.skipped).toEqual([
      { name: ".groundboard/ghost.overlay.json", reason: "overlay-orphan" },
    ]);
  });

  it("rejects an overlay whose note carries a link", () => {
    const linked = JSON.stringify({
      schemaVersion: 1,
      nodes: {},
      notes: [
        { id: "n", type: "rectangle", x: 0, y: 0, width: 1, height: 1, link: "https://x.example" },
      ],
    });
    const read = readBoardZip(
      zipOf({ [zipPaths.board("checkout")]: boardText, [zipPaths.overlay("checkout")]: linked }),
    );
    expect(read.ok && read.overlays).toEqual([]);
    expect(read.ok && read.rejected.map((r) => r.reason)).toEqual(["invalid-overlay"]);
  });
});

describe("writeBoardZip", () => {
  it("writes a zip that reads back to the same boards and scenes", () => {
    const zip = writeBoardZip([
      { path: zipPaths.board("checkout"), data: boardText },
      { path: zipPaths.scene("sketch"), data: scene() },
      { path: zipPaths.image("checkout"), data: new Uint8Array([137, 80, 78, 71]) },
      { path: "errors.txt", data: "broken: not valid JSON\n" },
    ]);
    const read = readBoardZip(zip);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.boards.map((b) => [b.slug, b.text])).toEqual([["checkout", boardText]]);
    expect(read.scenes.map((s) => s.slug)).toEqual(["sketch"]);
    expect(read.rejected).toEqual([]);
  });
});
