// Bundles @excalidraw/excalidraw into one ESM file that plain Node can import: the published
// build uses extensionless and JSON imports that Node's ESM loader refuses.
import { build } from "esbuild";

const t0 = performance.now();
const result = await build({
  stdin: {
    contents: 'export { exportToSvg } from "@excalidraw/excalidraw";',
    resolveDir: import.meta.dirname,
    loader: "js",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: "bundle/excalidraw-node.mjs",
  loader: { ".css": "empty", ".woff2": "empty" },
  define: { "process.env.NODE_ENV": '"production"' },
  minify: process.argv.includes("--minify"),
  metafile: true,
  logLevel: "warning",
});
console.log(`bundled in ${(performance.now() - t0).toFixed(0)} ms`);
const { outputs } = result.metafile;
for (const [file, info] of Object.entries(outputs)) {
  const top = Object.entries(info.inputs)
    .map(([p, v]) => [p.replace(/^.*node_modules\//, "").split("/").slice(0, p.includes("/@") ? 2 : 1).join("/"), v.bytesInOutput])
    .reduce((m, [k, v]) => m.set(k, (m.get(k) ?? 0) + v), new Map());
  console.log(file, (info.bytes / 1048576).toFixed(1), "MiB; largest inputs:");
  for (const [k, v] of [...top].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${k} ${(v / 1048576).toFixed(2)} MiB`);
}
