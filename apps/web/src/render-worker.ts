/// <reference lib="webworker" />
// Runs the render pipeline off the page's thread, so a large layout does not freeze the viewer.
import { renderBoardLocally } from "./local-render.ts";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (event: MessageEvent<{ id: number; board: unknown; overlay?: unknown }>) => {
  const { id, board, overlay } = event.data;
  const result = await renderBoardLocally(board, overlay).catch((error: unknown) => ({
    status: "error" as const,
    message: error instanceof Error ? error.message : String(error),
  }));
  self.postMessage({ id, result });
};
