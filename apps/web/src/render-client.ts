import type { Issue } from "./api.ts";
import { t } from "./i18n.ts";
import { type Scene, toScene } from "./input.ts";
import type { LocalRenderResult } from "./local-render.ts";

export type RenderResult =
  | { status: "ok"; scene: Scene; warnings: string[] }
  | { status: "invalid"; issues: Issue[]; warnings: string[] }
  | { status: "error"; message: string };

/** A layout that runs longer than this is stopped; the server allows 5 s, a laptop gets more. */
export const RENDER_TIMEOUT_MS = 30_000;

interface Pending {
  resolve: (result: LocalRenderResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function settleAll(result: LocalRenderResult): void {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.resolve(result);
    pending.delete(id);
  }
}

/** Stops the worker, so a runaway layout cannot hold the CPU; the next render starts a new one. */
function stopWorker(result: LocalRenderResult): void {
  worker?.terminate();
  worker = null;
  settleAll(result);
}

function startWorker(): Worker {
  const started = new Worker(new URL("./render-worker.ts", import.meta.url), { type: "module" });
  started.onmessage = (event: MessageEvent<{ id: number; result: LocalRenderResult }>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(event.data.id);
    entry.resolve(event.data.result);
  };
  started.onerror = (event) => {
    event.preventDefault();
    stopWorker({ status: "error", message: event.message || "the render worker stopped" });
  };
  return started;
}

function renderInWorker(board: unknown, overlay: unknown): Promise<LocalRenderResult> {
  worker ??= startWorker();
  const id = ++nextId;
  const running = worker;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (worker === running) stopWorker({ status: "error", message: t("render.timeout") });
    }, RENDER_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    running.postMessage({ id, board, overlay });
  });
}

async function renderInPage(board: unknown, overlay: unknown): Promise<LocalRenderResult> {
  const { renderBoardLocally } = await import("./local-render.ts");
  return renderBoardLocally(board, overlay);
}

/**
 * Validates, lays out and renders a board IR in the browser, in a worker when the page can
 * start one, with its layout overlay applied when one is given. Never throws.
 */
export async function renderBoard(board: unknown, overlay?: unknown): Promise<RenderResult> {
  let result: LocalRenderResult;
  try {
    result =
      typeof Worker === "function"
        ? await renderInWorker(board, overlay)
        : await renderInPage(board, overlay);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "error", message: t("render.failed", { error: detail }) };
  }
  if (result.status !== "ok") {
    return result.status === "error"
      ? { status: "error", message: t("render.failed", { error: result.message }) }
      : result;
  }
  const scene = toScene(result.scene);
  return scene
    ? { status: "ok", scene, warnings: result.warnings }
    : { status: "error", message: t("render.failed", { error: "no elements" }) };
}
