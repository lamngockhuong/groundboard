import { describe, expect, test } from "vitest";
import {
  type AtlasBoardKind,
  hasFlow,
  missingFlowRefs,
  type RefUse,
  refsOf,
  unlinkedFlowElements,
} from "./atlas-shape.ts";
import type { Board } from "./board.ts";

type Shape = Pick<Board, "nodes" | "edges">;

// Only the fields refsOf reads; the full schema is exercised by the board tests.
function board(nodes: object[], edges: object[]): Shape {
  return { nodes, edges } as unknown as Shape;
}

const screenBoard = board(
  [
    { id: "cart", kind: "screen", ref: "web:cart" },
    { id: "pay", kind: "element", ref: "web:cart/pay" },
    { id: "save", kind: "element", ref: "web:cart/save" },
    { id: "back", kind: "element", ref: "web:cart/back" },
    { id: "loose", kind: "element" },
    { id: "plain", kind: "element", ref: "web:cart/plain" },
    { id: "saved", kind: "screen", stateOf: "cart" },
  ],
  [
    { id: "e1", kind: "calls", from: "pay", toRef: "api:orders/create" },
    { id: "e2", kind: "transition", from: "save", to: "saved" },
    { id: "e3", kind: "navigates", from: "back", toRef: "web:home" },
    { id: "e4", kind: "calls", from: "loose", toRef: "api:orders/create" },
  ],
);

describe("refsOf needsFlow", () => {
  const { defined, used } = refsOf(screenBoard);
  const flag = (ref: string) => defined.find((d) => d.ref === ref)?.needsFlow;

  test("an element that calls an API needs a flow", () => {
    expect(flag("web:cart/pay")).toBe(true);
  });

  test("an element that changes state needs a flow", () => {
    expect(flag("web:cart/save")).toBe(true);
  });

  test("an element that only navigates does not", () => {
    expect(flag("web:cart/back")).toBeUndefined();
    expect(flag("web:cart/plain")).toBeUndefined();
    expect(flag("web:cart")).toBeUndefined();
  });

  test("an element without a ref defines nothing", () => {
    expect(defined.map((d) => d.nodeId)).not.toContain("loose");
    expect(used.map((u) => u.nodeId).filter((id) => id === "loose")).toEqual(["loose"]);
  });

  test("a flow step carrying an element ref is a use, never flagged", () => {
    const flow = board(
      [
        { id: "click", kind: "step", ref: "web:cart/pay" },
        { id: "create", kind: "step" },
      ],
      [{ id: "c", kind: "calls", from: "click", toRef: "api:orders/create" }],
    );
    const result = refsOf(flow);
    expect(result.defined).toEqual([]);
    expect(result.used).toContainEqual({ ref: "web:cart/pay", nodeId: "click" });
    expect(result.used.some((u) => "needsFlow" in u)).toBe(false);
  });
});

describe("unlinkedFlowElements", () => {
  test("lists elements without a ref that call or change state, in board order", () => {
    const b = board(
      [
        { id: "del", kind: "element" },
        { id: "ok", kind: "element" },
        { id: "nav", kind: "element" },
        { id: "reffed", kind: "element", ref: "web:x/reffed" },
        { id: "step", kind: "step" },
        { id: "next", kind: "screen", stateOf: "x" },
      ],
      [
        { id: "a", kind: "transition", from: "ok", to: "next" },
        { id: "b", kind: "transition", from: "del", to: "next" },
        { id: "c", kind: "navigates", from: "nav", toRef: "web:home" },
        { id: "d", kind: "calls", from: "reffed", toRef: "api:x/y" },
        { id: "e", kind: "calls", from: "step", toRef: "api:x/y" },
      ],
    );
    expect(unlinkedFlowElements(b)).toEqual(["del", "ok"]);
  });
});

describe("missingFlowRefs", () => {
  const kinds: Record<string, AtlasBoardKind> = {
    "a-flow": "flow",
    "an-api": "api",
    "an-overview": "overview",
    "web--cart": "screen",
  };
  const kindOf = (slug: string) => kinds[slug];
  const entry = (usedIn: RefUse["usedIn"]): RefUse => ({
    ref: "web:cart/pay",
    definedIn: [{ slug: "web--cart", nodeId: "pay", kind: "element" }],
    usedIn,
    needsFlow: true,
  });

  test("a node on a flow, api or overview board covers the ref", () => {
    for (const slug of ["a-flow", "an-api", "an-overview"]) {
      expect(hasFlow(entry([{ slug, nodeId: "n" }]), kindOf)).toBe(true);
    }
  });

  test("a screen board, an edge's toRef or an invalid board does not", () => {
    expect(hasFlow(entry([{ slug: "web--cart", nodeId: "n" }]), kindOf)).toBe(false);
    expect(hasFlow(entry([{ slug: "a-flow", nodeId: "n", edgeId: "e" }]), kindOf)).toBe(false);
    expect(hasFlow(entry([{ slug: "broken", nodeId: "n" }]), kindOf)).toBe(false);
  });

  test("lists only refs that need a flow and have none, in order", () => {
    const refs: RefUse[] = [
      { ...entry([]), ref: "web:cart/a" },
      { ...entry([{ slug: "a-flow", nodeId: "n" }]), ref: "web:cart/b" },
      { ...entry([]), ref: "web:cart/c", needsFlow: false },
      { ...entry([{ slug: "web--cart", nodeId: "n" }]), ref: "web:cart/d" },
    ];
    expect(missingFlowRefs(refs, kindOf)).toEqual(["web:cart/a", "web:cart/d"]);
  });
});
