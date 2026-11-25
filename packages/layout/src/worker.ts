import { Worker } from "node:worker_threads";
import type { Board } from "@groundboard/schema";
import type { ReferenceSize } from "./references.ts";
import type { Direction, LaidOutBoard } from "./types.ts";

export class LayoutTimeoutError extends Error {
  readonly code = "LAYOUT_TIMEOUT";
  constructor(timeoutMs: number) {
    super(`layout did not finish within ${timeoutMs} ms`);
    this.name = "LayoutTimeoutError";
  }
}

export interface WorkerLayoutOptions {
  direction?: Direction;
  references?: Readonly<Record<string, ReferenceSize>>;
  /** Hard limit; the worker is terminated when it passes. Default 5000. */
  timeoutMs?: number;
  /** Location of the worker entry; defaults to `layout-worker` next to this module. */
  workerUrl?: URL;
  /** Called with the worker right after it starts; lets callers observe its exit. */
  onWorker?: (worker: Worker) => void;
}

function defaultWorkerUrl(): URL {
  // From source (tests, type stripping) the entry is a .ts file; in the bundle it is .mjs.
  const ext = import.meta.url.endsWith(".ts") ? "ts" : "mjs";
  const name = `./layout-worker.${ext}`;
  return new URL(name, import.meta.url);
}

/**
 * Runs `layoutBoard` in a worker thread so a slow layout can never block the caller's event
 * loop, and terminates the worker if it does not answer within `timeoutMs`.
 */
export function layoutInWorker(
  board: Board,
  options: WorkerLayoutOptions = {},
): Promise<LaidOutBoard> {
  const timeoutMs = options.timeoutMs ?? 5000;
  return new Promise((resolve, reject) => {
    // The timeout bounds time; the heap limit bounds memory, so one runaway layout fails alone.
    const worker = new Worker(options.workerUrl ?? defaultWorkerUrl(), {
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    options.onWorker?.(worker);
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new LayoutTimeoutError(timeoutMs))),
      timeoutMs,
    );
    worker.once(
      "message",
      (message: { ok: true; value: LaidOutBoard } | { ok: false; message: string }) => {
        finish(() => (message.ok ? resolve(message.value) : reject(new Error(message.message))));
      },
    );
    worker.once("error", (error) => finish(() => reject(error)));
    worker.once("exit", (code) =>
      finish(() => reject(new Error(`layout worker exited with code ${code}`))),
    );
    worker.postMessage({ board, direction: options.direction, references: options.references });
  });
}
