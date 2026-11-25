import type { Worker } from "node:worker_threads";
import { expect, test } from "vitest";
import { loadExample } from "../test/boards.ts";
import { layoutBoard } from "./layout.ts";
import { LayoutTimeoutError, layoutInWorker } from "./worker.ts";

test("layoutInWorker returns the same result as layoutBoard", async () => {
  const board = loadExample("order-state-machine");
  const [direct, viaWorker] = await Promise.all([
    layoutBoard(board, { direction: "down" }),
    layoutInWorker(board, { direction: "down", timeoutMs: 20_000 }),
  ]);
  expect(viaWorker).toEqual(direct);
}, 30_000);

test("a 1 ms timeout rejects and leaves no live worker", async () => {
  let exited!: Promise<number>;
  const onWorker = (worker: Worker) => {
    exited = new Promise((resolve) => worker.once("exit", resolve));
  };
  await expect(
    layoutInWorker(loadExample("checkout-flow"), { timeoutMs: 1, onWorker }),
  ).rejects.toBeInstanceOf(LayoutTimeoutError);
  await expect(exited).resolves.toBeTypeOf("number");
});
