import path from "node:path";
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  platform: "node",
  target: "node24",
  // Everything but the native rasteriser is bundled: Excalidraw (its published build uses
  // imports plain Node refuses), React and linkedom. The Excalidraw chunk loads only after the
  // DOM shim is installed, through the dynamic import in src/index.ts.
  deps: { neverBundle: ["@resvg/resvg-js"], alwaysBundle: [/./] },
  loader: { ".css": "empty", ".woff2": "empty" },
  alias: {
    "@excalidraw/mermaid-to-excalidraw": path.resolve(
      import.meta.dirname,
      "src/stubs/mermaid-to-excalidraw.ts",
    ),
  },
  define: { "process.env.NODE_ENV": '"production"' },
  inputOptions: {
    onLog(level, log, handler) {
      // React and Radix mark their modules "use client", which means nothing in a Node bundle.
      if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
      handler(level, log);
    },
  },
  minify: true,
  dts: { entry: ["src/index.ts"] },
  clean: true,
});
