import { readdirSync } from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";
import { describe, expect, test } from "vitest";
import { fontFiles } from "../src/fonts.ts";

const fontDir = path.resolve(import.meta.dirname, "../dist/fonts");

describe('the fonts in dist/fonts (run "pnpm -r build" first)', () => {
  test("Excalifont's subsets are searched first, so its text is not drawn in another font", () => {
    const files = fontFiles(fontDir).map((f) => path.relative(fontDir, f).split(path.sep)[0]);
    const firstOther = files.findIndex((family) => family !== "Excalifont");
    expect(firstOther).toBeGreaterThan(0);
    expect(files.slice(firstOther)).not.toContain("Excalifont");
  });

  test("the merged Nunito is named Nunito and covers every Nunito subset", () => {
    const merged = fontkit.openSync(path.join(fontDir, "Nunito-merged", "Nunito.ttf"));
    expect(merged.familyName).toBe("Nunito");
    const covered = new Set(merged.characterSet);
    for (const file of readdirSync(path.join(fontDir, "Nunito"))) {
      const subset = fontkit.openSync(path.join(fontDir, "Nunito", file));
      const missing = subset.characterSet.filter((c) => !covered.has(c));
      expect(missing, `${file}: run scripts/merge-nunito.py again`).toEqual([]);
    }
  });

  test("Liberation Sans (GPL-2.0 with a font exception) is not shipped", () => {
    expect(readdirSync(fontDir)).not.toContain("Liberation");
  });
});
