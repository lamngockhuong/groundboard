import { cpSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));

/** Font families shipped with the viewer; each has a licence entry in font-licenses.json. */
const shippedFonts: string[] = JSON.parse(
  readFileSync(join(here, "font-licenses", "fonts.json"), "utf8"),
).map((f: { family: string }) => f.family);

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
