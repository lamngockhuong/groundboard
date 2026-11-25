import { defineConfig } from "vitest/config";

// Browser checks of the built viewer; kept out of `pnpm test` because they need a build and a
// Chromium download. Run with `pnpm test:browser`.
export default defineConfig({
  test: {
    include: ["test/**/*.browser.ts"],
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
