// Renders through the built package (dist/), the way the CLI loads it: the Excalidraw bundle and
// the TrueType fonts exist only after `pnpm build`.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { decodePng } from "../../groundboard/src/png.ts";

const dist = path.resolve(import.meta.dirname, "../dist/index.mjs");
const scene = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures/order-state-machine.excalidraw"), "utf8"),
);

type Module = typeof import("../src/index.ts");
let png: Module;

beforeAll(async () => {
  if (!existsSync(dist)) throw new Error(`${dist} is missing; run "pnpm -r build" first`);
  png = (await import(dist)) as Module;
});

/** RGBA of the pixel at (x, y). */
function pixel(image: ReturnType<typeof decodePng>, x: number, y: number): number[] {
  const at = (y * image.width + x) * 4;
  return [...image.data.subarray(at, at + 4)];
}

describe("renderPng", () => {
  test("draws the scene of a sequence board", async () => {
    const { sequenceBoard } = await import("../../schema/test/sequence-board.ts");
    const { renderBoard } = await import("../../groundboard/src/pipeline.ts");
    const rendered = await renderBoard(sequenceBoard());
    if (!rendered.scene) throw new Error(JSON.stringify(rendered.issues));
    const result = await png.renderPng(rendered.scene as never, { maxEdge: 1568, minText: 8 });
    const image = decodePng(result.tiles[0]?.png ?? new Uint8Array());
    expect(image.width).toBeGreaterThan(0);
    expect(image.height).toBeGreaterThan(0);
  });

  test("draws a small board as one PNG of the planned size, long edge at the cap", async () => {
    const result = await png.renderPng(scene, { maxEdge: 1568, minText: 8 });
    expect(result.tiles).toHaveLength(1);
    const [tile] = result.tiles;
    if (!tile) throw new Error("no tile");
    const image = decodePng(tile.png);
    expect([image.width, image.height]).toEqual([result.width, result.height]);
    expect(image.width).toBe(1568);
    expect(image.height).toBe(336);
    expect(pixel(image, 2, 2)).toEqual([255, 255, 255, 255]);
  });

  test("the dark theme draws a dark background", async () => {
    const result = await png.renderPng(scene, { theme: "dark", maxEdge: 400, minText: 1 });
    const [tile] = result.tiles;
    if (!tile) throw new Error("no tile");
    const [r, g, b] = pixel(decodePng(tile.png), 2, 2);
    expect(Math.max(r ?? 255, g ?? 255, b ?? 255)).toBeLessThan(40);
  });

  test("a board too small to read at the cap is cut into tiles no larger than the cap", async () => {
    const result = await png.renderPng(scene, { maxEdge: 600, minText: 8 });
    expect(result.scale).toBe(1);
    expect(result.tiles.length).toBe(result.rows * result.cols);
    expect(result.tiles.length).toBeGreaterThan(1);
    for (const tile of result.tiles) {
      const image = decodePng(tile.png);
      expect([image.width, image.height]).toEqual([tile.width, tile.height]);
      expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(600);
    }
    // The last column ends at the board's right edge.
    const last = result.tiles.find((t) => t.row === 1 && t.col === result.cols);
    expect((last?.x ?? 0) + (last?.width ?? 0)).toBe(result.width);
  });

  test("text keeps its own font when asked for the board font", async () => {
    // Different fonts draw different pixels; the same scene in two fonts must differ.
    const sans = await png.renderPng(scene, { maxEdge: 800, minText: 1 });
    const board = await png.renderPng(scene, { font: "board", maxEdge: 800, minText: 1 });
    expect(
      Buffer.from(board.tiles[0]?.png ?? []).equals(Buffer.from(sans.tiles[0]?.png ?? [])),
    ).toBe(false);
  });

  test("an unknown font is refused", async () => {
    await expect(png.renderPng(scene, { font: "comic" as never })).rejects.toThrow(/unknown font/);
  });
});
