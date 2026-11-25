import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@groundboard/render-excalidraw",
    // The Excalidraw builds use extensionless and JSON imports that plain Node rejects;
    // inlining lets Vite resolve them for the conformance oracles.
    server: { deps: { inline: [/@excalidraw\//, /excalidraw-next/] } },
    testTimeout: 30_000,
  },
});
