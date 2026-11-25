import { afterEach, expect, test, vi } from "vitest";
import { loadExample } from "../test/boards.ts";

// A Web Worker's global scope: `self` exists, `document` does not. elk.bundled.js checks for
// exactly that when ELK is first created and, unless kept from it, installs its own dispatcher
// as `self.onmessage`, so the worker running the layout stops receiving its own messages.
const scope = globalThis as { self?: unknown; onmessage?: unknown };

afterEach(() => {
  delete scope.self;
  delete scope.onmessage;
  vi.resetModules();
});

test("laying out inside a Web Worker leaves the worker's message handler in place", async () => {
  vi.resetModules();
  scope.self = globalThis;
  const handler = () => {};
  scope.onmessage = handler;
  const { layoutBoard } = await import("./layout.ts");

  await layoutBoard(loadExample("checkout-flow"));
  expect(scope.onmessage).toBe(handler);
  await layoutBoard(loadExample("order-state-machine"));
  expect(scope.onmessage).toBe(handler);
});
