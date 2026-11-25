import { readFileSync } from "node:fs";
import path from "node:path";
import { type Board, type BoardInput, parseBoard } from "@groundboard/schema";

export const repoRoot = path.resolve(import.meta.dirname, "../../..");
export const exampleNames = ["checkout-flow", "order-state-machine"] as const;

export function parse(input: unknown): Board {
  const result = parseBoard(input);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

export function loadExample(name: (typeof exampleNames)[number]): Board {
  return parse(
    JSON.parse(readFileSync(path.join(repoRoot, "examples", `${name}.board.json`), "utf8")),
  );
}

/** A synthetic board at the node limit: 10 groups of 50 nodes, chained, with cross links. */
export function syntheticBoard(nodeCount = 500, groupCount = 10): Board {
  const perGroup = Math.ceil(nodeCount / groupCount);
  const board: BoardInput = {
    schemaVersion: 1,
    title: "synthetic",
    question: "How does a large board lay out?",
    groups: Array.from({ length: groupCount }, (_, g) => ({ id: `g${g}`, label: `Group ${g}` })),
    nodes: [],
    edges: [],
    sources: [{ id: "s0", path: "src/synthetic.ts", line: 1, quote: "synthetic" }],
  };
  for (let i = 0; i < nodeCount; i++) {
    board.nodes.push({
      id: `n${i}`,
      kind: i % 7 === 0 ? "decision" : i % 5 === 0 ? "state" : "step",
      label: `Step ${i}: do the thing number ${i}`,
      groupId: `g${Math.floor(i / perGroup)}`,
      sourceIds: ["s0"],
    });
    if (i > 0 && i % perGroup !== 0) {
      board.edges?.push({ id: `e${i}`, from: `n${i - 1}`, to: `n${i}`, kind: "flow" });
    }
    if (i >= perGroup && i % 3 === 0) {
      board.edges?.push({ id: `x${i}`, from: `n${i - perGroup}`, to: `n${i}`, kind: "relates" });
    }
  }
  return parse(board);
}

const ROLES = ["bar", "text", "image", "button", "input", "checkbox", "link", "icon"] as const;

/**
 * Synthetic wireframe boards: `screenCount` screens, each with a header bar, a content
 * container holding a row of four buttons and stacked fields, and a footer; navigates edges
 * chain the screens, plus `crossEdges` extra screen-to-screen links.
 */
export function syntheticScreens(
  screenCount: number,
  elementsPerScreen: number,
  crossEdges = 0,
  platform: "web" | "mobile" = "mobile",
): Board {
  const board: BoardInput = {
    schemaVersion: 1,
    title: "screens",
    question: "How do many screens lay out?",
    nodes: [],
    edges: [],
    sources: [{ id: "s0", path: "src/app.tsx", line: 1, quote: "app" }],
  };
  for (let s = 0; s < screenCount; s++) {
    const screen = `screen${s}`;
    board.nodes.push({
      id: screen,
      kind: "screen",
      label: `Screen ${s}`,
      ref: `${platform}:screen-${s}`,
      platform,
      layoutFrom: "screenshot",
      sourceIds: ["s0"],
    });
    const body = `${screen}-body`;
    const row = `${screen}-row`;
    board.nodes.push(
      { id: `${screen}-header`, kind: "element", role: "bar", label: "Header", parentId: screen },
      { id: body, kind: "element", role: "container", label: "Content", parentId: screen },
      {
        id: row,
        kind: "element",
        role: "container",
        label: "Actions",
        parentId: body,
        direction: "row",
      },
    );
    let made = 4;
    for (let b = 0; b < 4 && made < elementsPerScreen; b++, made++) {
      board.nodes.push({
        id: `${screen}-act${b}`,
        kind: "element",
        role: "button",
        label: `Action number ${b} with a long label`,
        parentId: row,
        unresolved: "Frontend",
      });
    }
    for (let i = 0; made < elementsPerScreen; i++, made++) {
      const role = ROLES[i % ROLES.length] as (typeof ROLES)[number];
      const interactive =
        role === "button" || role === "input" || role === "checkbox" || role === "link";
      board.nodes.push({
        id: `${screen}-el${i}`,
        kind: "element",
        role,
        label: `${role} ${i}`,
        parentId: body,
        ...(interactive ? { unresolved: "Frontend" } : {}),
      });
    }
    board.nodes.push({
      id: `${screen}-footer`,
      kind: "element",
      role: "bar",
      label: "Tabs",
      parentId: screen,
    });
    if (s > 0) {
      board.edges?.push({
        id: `nav${s}`,
        from: `screen${s - 1}`,
        to: screen,
        kind: "navigates",
        sourceIds: ["s0"],
      });
    }
  }
  for (let e = 0; e < crossEdges; e++) {
    const from = (e * 7) % screenCount;
    const to = (e * 13 + 5) % screenCount;
    board.edges?.push({
      id: `cross${e}`,
      from: `screen${from}`,
      to: `screen${to === from ? (to + 1) % screenCount : to}`,
      kind: "relates",
    });
  }
  return parse(board);
}

/** A small checkout screen with in-screen edges, an element edge to another screen, and a toRef. */
export function checkoutScreens(): Board {
  return parse({
    schemaVersion: 1,
    title: "Checkout",
    question: "What is on the checkout screen?",
    nodes: [
      {
        id: "checkout",
        kind: "screen",
        label: "Checkout",
        ref: "web:checkout",
        platform: "web",
        layoutFrom: "code",
        sourceIds: ["route"],
      },
      {
        id: "header",
        kind: "element",
        role: "bar",
        label: "Shop header",
        parentId: "checkout",
        sourceIds: ["render"],
      },
      {
        id: "form",
        kind: "element",
        role: "container",
        label: "Payment",
        parentId: "checkout",
        sourceIds: ["render"],
      },
      {
        id: "fields",
        kind: "element",
        role: "container",
        label: "Card",
        parentId: "form",
        direction: "row",
        sourceIds: ["render"],
      },
      {
        id: "card",
        kind: "element",
        role: "input",
        label: "Card number",
        parentId: "fields",
        unresolved: "Frontend",
      },
      {
        id: "cvc",
        kind: "element",
        role: "input",
        label: "CVC",
        parentId: "fields",
        unresolved: "Frontend",
      },
      {
        id: "terms",
        kind: "element",
        role: "checkbox",
        label: "I accept the terms",
        parentId: "form",
        unresolved: "Frontend",
      },
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
        sourceIds: ["handler"],
      },
      {
        id: "done",
        kind: "screen",
        label: "Order placed",
        ref: "web:done",
        platform: "web",
        layoutFrom: "code",
        sourceIds: ["route"],
      },
      { id: "why", kind: "note", label: "Pay is disabled until terms are accepted" },
    ],
    edges: [
      {
        id: "to-done",
        from: "pay",
        to: "done",
        kind: "navigates",
        label: "on success",
        sourceIds: ["nav"],
      },
      { id: "to-cart", from: "back", toRef: "web:cart", kind: "navigates", sourceIds: ["nav"] },
      {
        id: "screen-cart",
        from: "checkout",
        toRef: "web:cart",
        kind: "navigates",
        sourceIds: ["nav"],
      },
      { id: "terms-pay", from: "terms", to: "pay", kind: "relates", label: "enables" },
      { id: "pay-self", from: "pay", to: "checkout", kind: "relates" },
      { id: "note", from: "why", to: "pay", kind: "relates" },
    ],
    sources: [
      { id: "route", path: "src/routes.tsx", line: 3, quote: "checkout" },
      { id: "render", path: "src/Checkout.tsx", line: 10 },
      { id: "handler", path: "src/Checkout.tsx", line: 20, quote: "onPay" },
      { id: "nav", path: "src/Checkout.tsx", line: 22, quote: "navigate" },
    ],
  });
}

/**
 * A screen board whose header navigates to three other boards (the menu to two of them), with
 * a same-board edge to a detail screen, a local edge, and a state whose button also leaves for
 * another board.
 */
export function refScreens(): Board {
  const el = (
    id: string,
    role: "bar" | "container" | "button" | "link" | "icon" | "text",
    label: string,
    parentId: string,
    extra: Record<string, unknown> = {},
  ) => ({ id, kind: "element", role, label, parentId, sourceIds: ["handler"], ...extra });
  const nav = (id: string, from: string, toRef: string, label?: string) => ({
    id,
    from,
    toRef,
    kind: "navigates",
    sourceIds: ["nav"],
    ...(label === undefined ? {} : { label }),
  });
  return parse({
    schemaVersion: 1,
    title: "Documents",
    question: "Where can the documents screen take the user?",
    nodes: [
      {
        id: "list",
        kind: "screen",
        label: "① Documents",
        ref: "web:documents",
        platform: "web",
        layoutFrom: "code",
        sourceIds: ["route"],
      },
      el("header", "bar", "Header", "list", { direction: "row" }),
      el("logo", "link", "Logo", "header", { action: "opens the dashboard" }),
      el("bell", "icon", "Notifications", "header", { action: "opens notifications" }),
      el("menu", "button", "User menu", "header", { action: "opens the menu" }),
      el("body", "container", "Documents", "list"),
      el("open", "button", "Open first document", "body", { action: "opens it" }),
      el("filter", "button", "Filter", "body", { action: "filters" }),
      el("hint", "text", "Filtered by date", "body"),
      { id: "empty", kind: "screen", label: "② Empty", stateOf: "list", sourceIds: ["empty"] },
      el("create", "button", "Create a document", "empty", { action: "opens the form" }),
      {
        id: "detail",
        kind: "screen",
        label: "Document",
        ref: "web:document",
        platform: "web",
        layoutFrom: "code",
        sourceIds: ["route"],
      },
      el("detail-title", "text", "Document title", "detail"),
    ],
    edges: [
      nav("to-dashboard", "logo", "web:dashboard"),
      nav("to-notifications", "bell", "web:notifications", "click"),
      nav("to-profile", "menu", "web:profile", "Profile"),
      nav("to-login", "menu", "web:login", "Log out"),
      nav("to-new", "create", "web:new-document"),
      { id: "to-detail", from: "open", to: "detail", kind: "navigates", sourceIds: ["nav"] },
      { id: "filter-hint", from: "filter", to: "hint", kind: "relates", label: "shows" },
      {
        id: "t-empty",
        from: "list",
        to: "empty",
        kind: "transition",
        label: "no documents",
        sourceIds: ["empty"],
      },
    ],
    sources: [
      { id: "route", path: "src/routes.tsx", line: 3, quote: "documents" },
      { id: "handler", path: "src/Documents.tsx", line: 10, quote: "onClick" },
      { id: "nav", path: "src/Documents.tsx", line: 22, quote: "navigate" },
      { id: "empty", path: "src/Documents.tsx", line: 30, quote: "empty" },
    ],
  });
}
