// Option B prototype: Excalidraw's own exportToSvg, run in Node under jsdom, then rasterised by
// resvg. No browser. Not wired into the CLI.
//
//   node render-b.mjs <scene.excalidraw> [--theme light|dark] [--font board|sans] [--scale 2] [--out dir]
//
// Writes <name>-b-<theme>.svg and <name>-b-<theme>.png and prints the time of each stage.
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const t = { start: performance.now() };
const lap = (name) => {
  t[name] = performance.now();
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    theme: { type: "string", default: "light" },
    font: { type: "string", default: "board" },
    dom: { type: "string", default: "jsdom" },
    raster: { type: "string", default: "native" },
    scale: { type: "string", default: "2" },
    out: { type: "string", default: path.join(import.meta.dirname, "out") },
  },
});
const input = positionals[0];
if (!input) throw new Error("usage: node render-b.mjs <scene.excalidraw>");

// --- 1. A DOM for Excalidraw: jsdom plus the three things jsdom lacks (canvas, FontFace, document.fonts).
// --dom linkedom tries the lighter DOM (about 1 MB unpacked against jsdom's 7 MB plus 18 dependencies).
const w =
  values.dom === "linkedom"
    ? (await import("linkedom")).parseHTML("<!doctype html><html><head></head><body></body></html>")
    : new (await import("jsdom")).JSDOM("<!doctype html><html><head></head><body></body></html>", {
        pretendToBeVisual: true,
        url: "http://localhost/",
      }).window;
if (!w.HTMLCanvasElement) w.HTMLCanvasElement = class {};
if (!w.location) w.location = new URL("http://localhost/");
if (!w.XMLSerializer) w.XMLSerializer = class { serializeToString = (n) => n.outerHTML; };
for (const key of [...Object.getOwnPropertyNames(w), "Element", "Node", "HTMLElement", "SVGElement", "Document", "DocumentFragment", "Text", "Event", "CustomEvent", "EventTarget", "HTMLCanvasElement", "HTMLImageElement", "Image", "DOMParser", "XMLSerializer", "MutationObserver", "getComputedStyle"]) {
  if (key in globalThis) continue;
  try {
    globalThis[key] = w[key];
  } catch {}
}
globalThis.window = w;
globalThis.document = w.document;
Object.defineProperty(globalThis, "navigator", { value: w.navigator, configurable: true });
globalThis.devicePixelRatio = 1;
// Only measureText is reached on the export path (it is not called for already wrapped text);
// a fixed advance is enough because the scene carries its own widths.
w.HTMLCanvasElement.prototype.getContext = () => ({
  measureText: (s) => ({ width: s.length * 8, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 3 }),
  font: "",
});
globalThis.FontFace = class {
  constructor(family, source, desc) {
    Object.assign(this, { family, source, ...desc, status: "loaded" });
  }
  load() {
    return Promise.resolve(this);
  }
};
Object.defineProperty(w.document, "fonts", {
  value: {
    add() {},
    delete() {},
    has: () => false,
    check: () => true,
    load: () => Promise.resolve([]),
    ready: Promise.resolve(),
    [Symbol.iterator]: function* () {},
    forEach() {},
    status: "loaded",
  },
});
lap("dom");

const { exportToSvg } = await import("./bundle/excalidraw-node.mjs");
lap("import");

// --- 2. Scene -> SVG with the same call the viewer makes, fonts left as family names.
const scene = JSON.parse(await readFile(input, "utf8"));
const theme = values.theme === "dark" ? "dark" : "light";
// The viewer's default reading font is "sans" (Nunito, family 6); "board" keeps what the renderer drew (Excalifont, 5).
const elements =
  values.font === "sans"
    ? scene.elements.map((el) => (el.type === "text" ? { ...el, fontFamily: 6 } : el))
    : scene.elements;
const svgEl = await exportToSvg({
  elements,
  appState: {
    ...scene.appState,
    exportBackground: true,
    exportWithDarkMode: theme === "dark",
    theme,
  },
  files: scene.files ?? {},
  exportPadding: 16,
  skipInliningFonts: true,
});
// Frame names are drawn in "Helvetica"; resvg has no system fonts here, so point it at the
// metric-compatible Liberation Sans that ships inside the Excalidraw package.
const svg = new w.XMLSerializer()
  .serializeToString(svgEl)
  .replaceAll('font-family="Helvetica,', 'font-family="Liberation Sans, Helvetica,');
// Known gap (see probe-fallback.mjs): a character that no listed family has, such as "→" that
// Excalifont lacks, makes resvg draw the whole line in the fallback font; a browser swaps only
// that glyph. Neither listing a fallback family nor a <tspan> around the glyph changes it.
lap("svg");

// --- 3. SVG -> PNG with resvg, given the Excalidraw fonts as TTF (see fonts-to-ttf.mjs).
// Fonts as Excalidraw ships them: unicode-range subsets, decompressed, under their own names. The
// Nunito subsets call themselves "Nunito ExtraLight Medium", so resvg never uses them for text set
// in "Nunito"; they still matter as fallback faces (they carry the Vietnamese glyphs Excalifont
// lacks). For the sans reading font, one merged copy named "Nunito" (merge-subsets.py) is added.
// Tried and worse: merging Excalifont into one file, renaming the Nunito subsets in place, and
// leaving Nunito out; each loses Vietnamese or Japanese glyphs (see the report).
const fontDir = path.join(import.meta.dirname, "out", "fonts");
const mergedNunito = path.join(import.meta.dirname, "out", "fonts-merged", "Nunito.ttf");
const fontFiles = [];
for (const family of await readdir(fontDir)) {
  for (const f of await readdir(path.join(fontDir, family))) fontFiles.push(path.join(fontDir, family, f));
}
if (values.font === "sans" && existsSync(mergedNunito)) fontFiles.push(mergedNunito);
const fitTo = { mode: "zoom", value: Number(values.scale) };
let png;
if (values.raster === "wasm") {
  // --raster wasm: the WebAssembly build, one file for every platform, fonts passed as buffers.
  const { Resvg, initWasm } = await import("@resvg/resvg-wasm");
  const wasmPath = path.join(import.meta.dirname, "node_modules", "@resvg", "resvg-wasm", "index_bg.wasm");
  await initWasm(await readFile(wasmPath));
  const fontBuffers = await Promise.all(fontFiles.map((f) => readFile(f)));
  png = new Resvg(svg, { fitTo, font: { fontBuffers, defaultFontFamily: "Excalifont" } }).render().asPng();
} else {
  const { Resvg } = await import("@resvg/resvg-js");
  png = new Resvg(svg, {
    fitTo,
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Excalifont" },
  })
    .render()
    .asPng();
}
lap("png");

const name = path.basename(input).replace(/\.excalidraw$/, "");
await mkdir(values.out, { recursive: true });
const base = path.join(values.out, `${name}-b-${theme}${values.font === "sans" ? "-sans" : ""}`);
await writeFile(`${base}.svg`, svg);
await writeFile(`${base}.png`, png);

const ms = (a, b) => `${(t[b] - t[a]).toFixed(0)} ms`;
console.log(
  `${base}.png  ${(png.length / 1024).toFixed(0)} KiB  dom ${ms("start", "dom")}, import ${ms("dom", "import")}, svg ${ms("import", "svg")}, png ${ms("svg", "png")}, total ${ms("start", "png")}`,
);
