import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "groundboard-png",
    // The tests render through the built package; the first render loads Excalidraw and fonts.
    testTimeout: 60_000,
  },
});
