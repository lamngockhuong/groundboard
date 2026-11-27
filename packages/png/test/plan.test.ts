import { describe, expect, test } from "vitest";
import { planSize, SIZE_DEFAULTS } from "../src/plan.ts";

const options = { ...SIZE_DEFAULTS, maxEdge: 1000, minText: 8, maxScale: 2, overlap: 40 };

describe("planSize", () => {
  test("a small board is drawn at the largest scale, in one image", () => {
    const plan = planSize(300, 200, 16, options);
    expect(plan).toMatchObject({ scale: 2, width: 600, height: 400, rows: 1, cols: 1 });
    expect(plan.tiles).toEqual([{ row: 1, col: 1, x: 0, y: 0, width: 600, height: 400 }]);
  });

  test("a board wider than the cap is shrunk to it while its text stays readable", () => {
    const plan = planSize(1600, 400, 16, options);
    expect(plan.scale).toBeCloseTo(0.625);
    expect(plan).toMatchObject({ width: 1000, height: 250, rows: 1, cols: 1 });
  });

  test("a board whose text would be unreadable at the cap is tiled at scale 1", () => {
    const plan = planSize(3000, 1200, 14, options);
    expect(plan.scale).toBe(1);
    expect(plan).toMatchObject({ width: 3000, height: 1200, rows: 2, cols: 4 });
    for (const tile of plan.tiles) {
      expect(tile.width).toBeLessThanOrEqual(1000);
      expect(tile.height).toBeLessThanOrEqual(1000);
      expect(tile.x + tile.width).toBeLessThanOrEqual(3000);
      expect(tile.y + tile.height).toBeLessThanOrEqual(1200);
    }
    // Every column reaches the right edge and neighbours share at least the overlap.
    const row1 = plan.tiles.filter((t) => t.row === 1);
    expect(row1[0]?.x).toBe(0);
    const last = row1.at(-1);
    expect((last?.x ?? 0) + (last?.width ?? 0)).toBe(3000);
    for (let i = 1; i < row1.length; i++) {
      const prev = row1[i - 1];
      const tile = row1[i];
      if (!prev || !tile) throw new Error("unreachable");
      expect(prev.x + prev.width - tile.x).toBeGreaterThanOrEqual(40);
    }
  });

  test("tiles are drawn larger than scale 1 when the text needs it, up to the largest scale", () => {
    expect(planSize(5000, 400, 4, options).scale).toBe(2);
    expect(planSize(5000, 400, 6, options).scale).toBeCloseTo(8 / 6);
  });

  test("a board with no text is always fitted into one image", () => {
    const plan = planSize(20000, 300, 0, options);
    expect(plan).toMatchObject({ width: 1000, rows: 1, cols: 1 });
  });
});
