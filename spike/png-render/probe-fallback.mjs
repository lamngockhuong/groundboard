// Probe: how resvg picks a face when one family name ("Excalifont") is split into several
// unicode-range subset files, and what a character none of them has does to the line.
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

const fontDir = path.join(import.meta.dirname, "out", "fonts");
const all = [];
for (const fam of await readdir(fontDir)) for (const f of await readdir(path.join(fontDir, fam))) all.push(path.join(fontDir, fam, f));
const lines = [
  "after paying web:home",
  "after paying → web:home",
  "1 after paying",
  "1 → web:home",
  "Mọi SKU 在庫は",
];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${lines.length * 40 + 20}"><rect width="100%" height="100%" fill="#fff"/>${lines
  .map((s, i) => `<text x="10" y="${40 + i * 40}" font-family="Excalifont, Xiaolai, Segoe UI Emoji" font-size="24">${s}</text>`)
  .join("")}</svg>`;
for (const [label, files] of [
  ["all-subsets", all],
  ["excalifont-only", all.filter((f) => f.includes("Excalifont"))],
]) {
  const r = new Resvg(svg, { font: { fontFiles: files, loadSystemFonts: false, defaultFontFamily: "Excalifont" } });
  await writeFile(path.join(import.meta.dirname, "out", `probe-${label}.png`), r.render().asPng());
}
