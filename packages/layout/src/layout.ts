import { type Board, isSequenceBoard } from "@groundboard/schema";
import ElkBundled from "elkjs/lib/elk.bundled.js";
import type { ELK } from "elkjs/lib/elk-api.js";
import { fromElk } from "./from-elk.ts";
import type { ReferenceSize } from "./references.ts";
import { layoutSequence } from "./sequence.ts";
import { toElk } from "./to-elk.ts";
import type { Direction, LaidOutBoard } from "./types.ts";

export interface LayoutOptions {
  direction?: Direction;
  /** Room to reserve beside frames for a reference image, by screen id. */
  references?: Readonly<Record<string, ReferenceSize>>;
  /** Rejects with an AbortError once aborted. ELK itself cannot be interrupted; use `layoutInWorker` for a hard limit. */
  signal?: AbortSignal;
}

// The bundled file is CommonJS (`module.exports = ELK`); under NodeNext its typings describe
// the module object, so the default import is cast to the constructor it is at runtime.
const ElkConstructor = ElkBundled as unknown as new () => ELK;
let elk: ELK | undefined;

/**
 * Creates ELK without letting it take over a Web Worker. elk.bundled.js can itself be loaded
 * as ELK's worker script, so when it starts in a scope with `self` and no `document` it sets
 * `self.onmessage` to its own dispatcher. Inside a worker that runs this layout, that replaces
 * the worker's handler and every message after the first goes to ELK instead. ELK runs in
 * this thread here and does not need that handler, so the worker's own is put back.
 */
function createElk(): ELK {
  const scope = globalThis as { onmessage?: unknown };
  const hadHandler = "onmessage" in scope;
  const handler = scope.onmessage;
  const created = new ElkConstructor();
  if (hadHandler) scope.onmessage = handler;
  else delete scope.onmessage;
  return created;
}

/** Lays out a validated board. The same board and options always give the same result. */
export async function layoutBoard(
  board: Board,
  options: LayoutOptions = {},
): Promise<LaidOutBoard> {
  const direction = options.direction ?? "right";
  options.signal?.throwIfAborted();
  // A sequence board places its columns and rows itself; ELK is never started for it.
  if (isSequenceBoard(board)) return layoutSequence(board);
  const input = toElk(board, direction, options.references);
  elk ??= createElk();
  const result = await elk.layout(input.graph);
  options.signal?.throwIfAborted();
  return fromElk(result, board, input, direction);
}
