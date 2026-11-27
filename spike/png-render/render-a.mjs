// Option A prototype: a headless Chromium (Playwright's, or the installed Chrome) runs the same
// exportToBlob the viewer's "Save PNG" calls. Every request is answered from local files; any
// request to another origin is refused and reported, so nothing leaves the machine.
//
//   node render-a.mjs <scene.excalidraw> [--theme light|dark] [--font board|sans] [--channel chrome]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const t = { start: performance.now() };
const lap = (n) => {
  t[n] = performance.now();
};
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    theme: { type: "string", default: "light" },
    font: { type: "string", default: "board" },
    scale: { type: "string", default: "2" },
    channel: { type: "string" },
    out: { type: "string", default: path.join(import.meta.dirname, "out") },
  },
});
const input = positionals[0];
const here = import.meta.dirname;
const pkgProd = path.join(here, "node_modules", "@excalidraw", "excalidraw", "dist", "prod");
const browserBundle = path.join(here, "bundle", "browser", "excalidraw.mjs");

// A browser build of the same package, fonts emitted as files next to it.
await build({
  stdin: {
    contents: 'export { exportToBlob } from "@excalidraw/excalidraw";',
    resolveDir: here,
    loader: "js",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: browserBundle,
  loader: { ".css": "empty", ".woff2": "file" },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "error",
});
lap("bundle");

const ORIGIN = "http://groundboard.local";
const browser = await chromium.launch(values.channel ? { channel: values.channel } : {});
lap("launch");
const page = await browser.newPage();
const refused = [];
await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== ORIGIN) {
    refused.push(url.href);
    return route.abort();
  }
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (rel === "" || rel === "index.html") {
    return route.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset=utf-8><body></body>" });
  }
  // The bundle and its emitted fonts, then the package's own font files (EXCALIDRAW_ASSET_PATH).
  for (const root of [path.dirname(browserBundle), pkgProd]) {
    try {
      const body = await readFile(path.join(root, rel.replace(/^assets\//, "")));
      const type = rel.endsWith(".mjs") || rel.endsWith(".js") ? "text/javascript" : rel.endsWith(".woff2") ? "font/woff2" : "application/octet-stream";
      return route.fulfill({ contentType: type, body });
    } catch {}
  }
  return route.fulfill({ status: 404, body: "" });
});
await page.goto(`${ORIGIN}/index.html`);

const scene = JSON.parse(await readFile(input, "utf8"));
const theme = values.theme === "dark" ? "dark" : "light";
const elements =
  values.font === "sans"
    ? scene.elements.map((el) => (el.type === "text" ? { ...el, fontFamily: 6 } : el))
    : scene.elements;
const base64 = await page.evaluate(
  async ({ origin, elements, appState, files, scale }) => {
    window.EXCALIDRAW_ASSET_PATH = `${origin}/assets/`;
    const { exportToBlob } = await import(`${origin}/excalidraw.mjs`);
    const blob = await exportToBlob({
      elements,
      appState,
      files,
      mimeType: "image/png",
      exportPadding: 16,
      getDimensions: (w, h) => ({ width: w * scale, height: h * scale, scale }),
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  {
    origin: ORIGIN,
    elements,
    appState: { ...scene.appState, exportBackground: true, exportWithDarkMode: theme === "dark", theme },
    files: scene.files ?? {},
    scale: Number(values.scale),
  },
);
lap("png");
await browser.close();

const name = path.basename(input).replace(/\.excalidraw$/, "");
await mkdir(values.out, { recursive: true });
const file = path.join(values.out, `${name}-a-${theme}${values.font === "sans" ? "-sans" : ""}.png`);
const png = Buffer.from(base64, "base64");
await writeFile(file, png);
const ms = (a, b) => `${(t[b] - t[a]).toFixed(0)} ms`;
console.log(
  `${file}  ${(png.length / 1024).toFixed(0)} KiB  bundle ${ms("start", "bundle")}, launch ${ms("bundle", "launch")}, export ${ms("launch", "png")}, total ${ms("start", "png")}`,
);
if (refused.length) console.log(`refused ${refused.length} off-machine request(s):`, [...new Set(refused.map((u) => new URL(u).origin))].join(" "));
