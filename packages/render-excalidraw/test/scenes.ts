import { readFileSync } from "node:fs";
import path from "node:path";
import { type LaidOutBoard, layoutBoard } from "@groundboard/layout";
import { type Board, parseBoard } from "@groundboard/schema";
import type { ExcalidrawScene } from "../src/elements.ts";
import { renderExcalidraw } from "../src/render.ts";

export const repoRoot = path.resolve(import.meta.dirname, "../../..");
export const exampleNames = ["checkout-flow", "order-state-machine"] as const;

export function loadBoard(name: string, patch?: (raw: Record<string, unknown>) => void): Board {
  const raw = JSON.parse(
    readFileSync(path.join(repoRoot, "examples", `${name}.board.json`), "utf8"),
  ) as Record<string, unknown>;
  patch?.(raw);
  const result = parseBoard(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

export async function renderExample(
  name: string,
  patch?: (raw: Record<string, unknown>) => void,
): Promise<{ board: Board; laidOut: LaidOutBoard; scene: ExcalidrawScene }> {
  const board = loadBoard(name, patch);
  const laidOut = await layoutBoard(board);
  return { board, laidOut, scene: renderExcalidraw(laidOut, board) };
}

/** A checkout screen drawn from Figma, with every role, a navigates edge and a toRef chip. */
export function screenBoard(): Board {
  const result = parseBoard({
    schemaVersion: 1,
    title: "Checkout screen",
    question: "What is on the checkout screen and where does it go?",
    nodes: [
      {
        id: "checkout",
        kind: "screen",
        label: "Checkout",
        ref: "web:checkout",
        platform: "web",
        layoutFrom: "figma",
        sourceIds: ["route", "fig"],
      },
      {
        id: "header",
        kind: "element",
        role: "bar",
        label: "Shop header",
        parentId: "checkout",
        direction: "row",
      },
      { id: "logo", kind: "element", role: "icon", label: "Logo", parentId: "header" },
      { id: "title", kind: "element", role: "text", label: "Checkout", parentId: "header" },
      { id: "form", kind: "element", role: "container", label: "Payment", parentId: "checkout" },
      {
        id: "card",
        kind: "element",
        role: "container",
        label: "Card",
        parentId: "form",
        direction: "row",
      },
      {
        id: "number",
        kind: "element",
        role: "input",
        label: "Card number",
        parentId: "card",
        unresolved: "No handler found (Frontend)",
      },
      {
        id: "cvc",
        kind: "element",
        role: "input",
        label: "CVC",
        parentId: "card",
        unresolved: "No handler found (Frontend)",
      },
      {
        id: "terms",
        kind: "element",
        role: "checkbox",
        label: "I accept the terms",
        parentId: "form",
        unresolved: "No handler found (Frontend)",
      },
      { id: "banner", kind: "element", role: "image", label: "Product image", parentId: "form" },
      {
        id: "pay",
        kind: "element",
        role: "button",
        label: "Pay",
        parentId: "form",
        ref: "web:checkout/pay-button",
        action: "submits the order",
        sourceIds: ["handler"],
      },
      {
        id: "back",
        kind: "element",
        role: "link",
        label: "Back to cart",
        parentId: "checkout",
        action: "opens the cart",
        sourceIds: ["back-handler"],
      },
      {
        id: "done",
        kind: "screen",
        label: "Order placed",
        ref: "web:order-placed",
        platform: "web",
        layoutFrom: "code",
        sourceIds: ["route"],
      },
    ],
    edges: [
      {
        id: "pay-done",
        from: "pay",
        to: "done",
        kind: "navigates",
        label: "on success",
        sourceIds: ["nav"],
      },
      {
        id: "back-cart",
        from: "back",
        toRef: "web:cart",
        kind: "navigates",
        sourceIds: ["back-handler"],
      },
      { id: "terms-pay", from: "terms", to: "pay", kind: "relates", label: "enables" },
    ],
    sources: [
      { id: "route", path: "examples/fixtures/checkout/cart.ts", line: 1, quote: "x" },
      { id: "fig", kind: "figma", fileKey: "AbCdEf0123456789", nodeId: "12:34" },
      { id: "handler", path: "examples/fixtures/checkout/payment.ts", line: 2, quote: "x" },
      { id: "back-handler", path: "examples/fixtures/checkout/cart.ts", line: 3, quote: "x" },
      { id: "nav", path: "examples/fixtures/checkout/payment.ts", line: 4, quote: "x" },
    ],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

export async function renderScreens(): Promise<{
  board: Board;
  laidOut: LaidOutBoard;
  scene: ExcalidrawScene;
}> {
  const board = screenBoard();
  const laidOut = await layoutBoard(board);
  return { board, laidOut, scene: renderExcalidraw(laidOut, board) };
}

/** A board of the spec-stage lifecycle fixture: requirements, a mockup and Figma, no code. */
export async function renderLifecycleSpec(
  slug: "overview-web" | "web--signup",
  patch?: (raw: Record<string, unknown>) => void,
): Promise<{ board: Board; laidOut: LaidOutBoard; scene: ExcalidrawScene }> {
  const raw = JSON.parse(
    readFileSync(
      path.join(repoRoot, "examples/fixtures/lifecycle/spec/.groundboard", `${slug}.board.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
  patch?.(raw);
  const result = parseBoard(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  const laidOut = await layoutBoard(result.value);
  return { board: result.value, laidOut, scene: renderExcalidraw(laidOut, result.value) };
}
