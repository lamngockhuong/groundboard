#!/usr/bin/env node
// Writes the fonts the rasteriser reads into dist/fonts/:
//   - the Excalidraw fonts whose licence the project vetted (apps/web/font-licenses/fonts.json,
//     the same list the viewer ships), decompressed from woff2 to TrueType (resvg reads no
//     woff2), one folder per family, the unicode-range subsets kept as separate files. Liberation
//     Sans (GPL-2.0 with a font exception) is not on that list and is left out, as in the viewer;
//   - fonts/Nunito.ttf, the Nunito subsets merged into one face named "Nunito"
//     (scripts/merge-nunito.py; see src/fonts.ts for why).
// Run after tsdown, which empties dist/.

import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import wawoff2 from "wawoff2";

const packageDir = path.resolve(import.meta.dirname, "..");
const vettedFonts = path.resolve(packageDir, "../../apps/web/font-licenses/fonts.json");
const out = path.join(packageDir, "dist", "fonts");

/** The fonts folder inside the installed @excalidraw/excalidraw. */
export function excalidrawFontDir() {
  const require = createRequire(path.join(packageDir, "package.json"));
  // The package exports no package.json; its main entry is dist/prod/index.js.
  const entry = require.resolve("@excalidraw/excalidraw");
  return path.join(path.dirname(entry), "fonts");
}

const source = excalidrawFontDir();
let files = 0;
const families = JSON.parse(readFileSync(vettedFonts, "utf8")).map((font) => font.family);
for (const family of families) {
  mkdirSync(path.join(out, family), { recursive: true });
  for (const file of readdirSync(path.join(source, family)).sort()) {
    if (!file.endsWith(".woff2")) continue;
    const ttf = await wawoff2.decompress(readFileSync(path.join(source, family, file)));
    writeFileSync(path.join(out, family, file.replace(/\.woff2$/, ".ttf")), ttf);
    files++;
  }
}
mkdirSync(path.join(out, "Nunito-merged"), { recursive: true });
copyFileSync(
  path.join(packageDir, "fonts", "Nunito.ttf"),
  path.join(out, "Nunito-merged", "Nunito.ttf"),
);
console.log(
  `build-fonts: ${files} files of ${families.length} Excalidraw families and the merged Nunito in dist/fonts`,
);
