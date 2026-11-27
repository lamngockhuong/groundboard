// Cuts a window out of a PNG so two outputs can be looked at side by side at full size.
//   node crop.mjs <in.png> <out.png> <x> <y> <w> <h>
import { readFile, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";

const [input, output, ...box] = process.argv.slice(2);
const [x, y, w, h] = box.map(Number);
const src = PNG.sync.read(await readFile(input));
const dst = new PNG({ width: w, height: h });
PNG.bitblt(src, dst, x, y, w, h, 0, 0);
await writeFile(output, PNG.sync.write(dst));
