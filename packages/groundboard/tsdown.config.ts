import { defineConfig } from "tsdown";
import { privatePackagePattern } from "../../scripts/private-packages.mjs";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    // Loaded by `layoutInWorker` from next to the chunk that contains it.
    "layout-worker": "../layout/src/layout-worker.ts",
  },
  format: "esm",
  platform: "node",
  target: "node24",
  // Workspace packages marked private are internal and bundled; real dependencies stay
  // external, and so does @groundboard/png, which is published and imported only on demand.
  deps: { alwaysBundle: [privatePackagePattern()] },
  // Declarations are generated for the library entry only, with the internal packages' types
  // inlined so the published .d.mts names no private package.
  dts: { entry: ["src/index.ts"], tsconfig: "tsconfig.build.json" },
  clean: true,
});
