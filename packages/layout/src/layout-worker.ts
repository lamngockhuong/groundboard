// Worker-thread entry for `layoutInWorker`. Receives one board, posts one result, then idles
// until the parent terminates it.
import { parentPort } from "node:worker_threads";
import { layoutBoard } from "./layout.ts";

parentPort?.once(
  "message",
  async (message: {
    board: Parameters<typeof layoutBoard>[0];
    direction?: "right" | "down";
    references?: NonNullable<Parameters<typeof layoutBoard>[1]>["references"];
  }) => {
    try {
      const value = await layoutBoard(message.board, {
        direction: message.direction ?? "right",
        ...(message.references ? { references: message.references } : {}),
      });
      parentPort?.postMessage({ ok: true, value });
    } catch (error) {
      parentPort?.postMessage({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
