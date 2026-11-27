import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));

/** Font families shipped with the viewer; each has a licence entry in font-licenses.json. */
const shippedFonts: string[] = JSON.parse(
  readFileSync(join(here, "font-licenses", "fonts.json"), "utf8"),
).map((f: { family: string }) => f.family);

/** Font family Excalidraw splits into chunks by `unicode-range`, for Chinese, Japanese, Korean. */
const CJK_FAMILY = "Xiaolai";
/** Written next to the fonts: each Xiaolai chunk file and the `unicode-range` it serves. */
const CJK_RANGES_FILE = "xiaolai-ranges.json";

/**
 * The `unicode-range` Excalidraw declares for each Xiaolai chunk, read from its bundle: the
 * browser fetches a chunk only for text in its range, so `groundboard export` can ship just
 * the chunks an atlas's text needs. Fails unless every chunk file has exactly one range, so an
 * Excalidraw upgrade that changes the bundle stops the build instead of shipping a wrong map.
 */
function cjkRanges(pkgDir: string, fontDir: string): Record<string, string> {
  const files = readdirSync(fontDir).filter((f) => f.endsWith(".woff2"));
  const prod = join(pkgDir, "dist", "prod");
  const ranges: Record<string, string> = {};
  for (const name of readdirSync(prod).filter((f) => f.endsWith(".js"))) {
    const code = readFileSync(join(prod, name), "utf8");
    if (!code.includes(`./fonts/${CJK_FAMILY}/`)) continue;
    const uris = new Map<string, string>();
    for (const m of code.matchAll(/var ([\w$]+)="\.\/fonts\/Xiaolai\/([^"]+)"/g)) {
      uris.set(m[1] as string, m[2] as string);
    }
    for (const m of code.matchAll(/\{uri:([\w$]+),descriptors:\{unicodeRange:"([^"]+)"\}\}/g)) {
      const file = uris.get(m[1] as string);
      if (file !== undefined) ranges[file] = m[2] as string;
    }
  }
  const missing = files.filter((f) => ranges[f] === undefined);
  if (missing.length > 0 || Object.keys(ranges).length !== files.length) {
    throw new Error(
      `cannot map the ${CJK_FAMILY} chunks to their unicode-range: ${missing.length} of ${files.length} files have none in the Excalidraw bundle; update cjkRanges in vite.config.ts`,
    );
  }
  return ranges;
}

/**
 * Copies Excalidraw's canvas fonts next to the built page, so `window.EXCALIDRAW_ASSET_PATH`
 * (set to the page's own base URL) serves them and no CDN is contacted.
 */
function excalidrawFonts(): Plugin {
  return {
    name: "groundboard:excalidraw-fonts",
    apply: "build",
    writeBundle(options) {
      // pnpm links the package through a symlink; resolve it to the real store directory.
      const pkgDir = realpathSync(join(here, "node_modules", "@excalidraw", "excalidraw"));
      const fonts = join(pkgDir, "dist", "prod", "fonts");
      if (!existsSync(fonts)) {
        throw new Error(`Excalidraw fonts not found at ${fonts}`);
      }
      const outDir = options.dir ?? resolve(here, "dist");
      // Only families with a vetted licence are copied; any other family (Liberation Sans,
      // GPL-2.0 with a font exception) falls back to Excalidraw's CDN if a user picks it.
      for (const family of shippedFonts) {
        cpSync(join(fonts, family), join(outDir, "fonts", family), { recursive: true });
      }
      if (shippedFonts.includes(CJK_FAMILY)) {
        const ranges = cjkRanges(pkgDir, join(fonts, CJK_FAMILY));
        writeFileSync(
          join(outDir, "fonts", CJK_RANGES_FILE),
          `${JSON.stringify(ranges, null, 2)}\n`,
        );
      }
    },
  };
}

/**
 * In development the viewer's API, and the canvas fonts a build copies next to the page, come
 * from a running `groundboard serve` (`pnpm dev` starts one). Without it the viewer still
 * opens, with the sample boards it renders in the browser.
 */
const devServer = process.env.GROUNDBOARD_DEV_SERVER ?? "http://127.0.0.1:8787";

export default defineConfig({
  base: "./",
  plugins: [react(), excalidrawFonts()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    // A taken port is a viewer left running: stop it rather than start a second one.
    strictPort: true,
    // `/healthz` tells the viewer whether the server serves an atlas.
    proxy: { "/api": devServer, "/healthz": devServer, "/fonts": devServer },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The editor chunk is large by nature; it is loaded lazily.
    chunkSizeWarningLimit: 4096,
  },
});
