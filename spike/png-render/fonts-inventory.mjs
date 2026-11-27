// Lists the font files that ship inside @excalidraw/excalidraw, per family, with sizes.
import { createRequire } from "node:module";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const root = path.join(import.meta.dirname, "node_modules", "@excalidraw", "excalidraw");
const fonts = path.join(root, "dist", "prod", "fonts");
for (const fam of readdirSync(fonts)) {
  const files = readdirSync(path.join(fonts, fam));
  const size = files.reduce((s, f) => s + statSync(path.join(fonts, fam, f)).size, 0);
  console.log(fam.padEnd(16), String(files.length).padStart(4), "files", (size / 1024).toFixed(0).padStart(6), "KiB", files.slice(0, 2).join(" "));
}
