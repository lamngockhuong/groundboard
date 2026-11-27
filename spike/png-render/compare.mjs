// Compares each option-B PNG with the option-A PNG of the same board and theme (A runs the
// viewer's own export, so it is the reference) and writes a diff image beside them.
//
//   node compare.mjs <name-theme> ...     e.g. checkout-flow-light web--checkout-dark
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const out = path.join(import.meta.dirname, "out");
for (const id of process.argv.slice(2)) {
  const [name, theme] = [id.slice(0, id.lastIndexOf("-")), id.slice(id.lastIndexOf("-") + 1)];
  const a = PNG.sync.read(await readFile(path.join(out, `${name}-a-${theme}.png`)));
  const b = PNG.sync.read(await readFile(path.join(out, `${name}-b-${theme}.png`)));
  if (a.width !== b.width || a.height !== b.height) {
    console.log(`${id}: size differs, A ${a.width}x${a.height}, B ${b.width}x${b.height}`);
    continue;
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.2 });
  await writeFile(path.join(out, `${name}-diff-${theme}.png`), PNG.sync.write(diff));
  console.log(
    `${id}: ${a.width}x${a.height}, ${n} pixels differ (${((100 * n) / (a.width * a.height)).toFixed(2)}%)`,
  );
}
