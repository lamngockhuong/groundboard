// Decompresses the woff2 fonts that ship inside @excalidraw/excalidraw into TTF files, because
// resvg reads only TrueType/OpenType. A one-off step: a real CLI would ship the TTFs it needs
// (or decompress on first use into a cache directory).
//
//   node fonts-to-ttf.mjs [family ...]     default: Excalifont Nunito Liberation Xiaolai
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import wawoff2 from "wawoff2";

const pkg = path.join(import.meta.dirname, "node_modules", "@excalidraw", "excalidraw");
const src = path.join(pkg, "dist", "prod", "fonts");
const out = path.join(import.meta.dirname, "out", "fonts");
const families = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["Excalifont", "Nunito", "Liberation", "Xiaolai"];

const t0 = performance.now();
let inBytes = 0;
let outBytes = 0;
for (const family of families) {
  await mkdir(path.join(out, family), { recursive: true });
  for (const file of await readdir(path.join(src, family))) {
    const woff2 = await readFile(path.join(src, family, file));
    const ttf = await wawoff2.decompress(woff2);
    await writeFile(path.join(out, family, file.replace(/\.woff2$/, ".ttf")), ttf);
    inBytes += woff2.length;
    outBytes += ttf.length;
  }
}
console.log(
  `${families.join(", ")}: ${(inBytes / 1024).toFixed(0)} KiB woff2 -> ${(outBytes / 1024).toFixed(0)} KiB ttf in ${(performance.now() - t0).toFixed(0)} ms`,
);
for (const family of families) {
  const files = await readdir(path.join(out, family));
  let size = 0;
  for (const f of files) size += (await stat(path.join(out, family, f))).size;
  console.log(`  ${family}: ${files.length} files, ${(size / 1024).toFixed(0)} KiB`);
}
