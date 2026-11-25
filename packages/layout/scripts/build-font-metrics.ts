// Builds src/font-metrics.json: the advance width of every code point that Excalifont covers.
// Run after upgrading @excalidraw/excalidraw: `pnpm --filter @groundboard/layout font-metrics`.
// Only derived metrics are written; the font itself is not redistributed.

import { readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";

const packageDir = realpathSync(
  path.join(import.meta.dirname, "..", "node_modules", "@excalidraw", "excalidraw"),
);
const fontDir = path.join(packageDir, "dist", "prod", "fonts", "Excalifont");
const files = readdirSync(fontDir)
  .filter((f) => f.endsWith(".woff2"))
  .sort();

const widths: Record<string, number> = {};
let unitsPerEm = 0;
for (const file of files) {
  const font = fontkit.openSync(path.join(fontDir, file)) as fontkit.Font;
  if (unitsPerEm === 0) unitsPerEm = font.unitsPerEm;
  else if (font.unitsPerEm !== unitsPerEm) throw new Error(`${file}: unitsPerEm differs`);
  for (const codePoint of font.characterSet) {
    const glyph = font.glyphForCodePoint(codePoint);
    if (glyph.id === 0) continue;
    widths[String(codePoint)] ??= glyph.advanceWidth;
  }
}

const sorted = Object.fromEntries(Object.entries(widths).sort(([a], [b]) => Number(a) - Number(b)));
const out = {
  font: "Excalifont",
  source: `@excalidraw/excalidraw ${JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")).version}`,
  unitsPerEm,
  widths: sorted,
};
const target = path.join(import.meta.dirname, "..", "src", "font-metrics.json");
writeFileSync(target, `${JSON.stringify(out)}\n`);
console.log(`wrote ${Object.keys(sorted).length} code points from ${files.length} files`);
