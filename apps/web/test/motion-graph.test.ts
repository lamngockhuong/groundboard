import { describe, expect, it } from "vitest";
import {
  arrowsTouching,
  hiddenAtStep,
  intersects,
  presentationSteps,
  readMotionGraph,
  sceneAtStep,
  selectedBoardItems,
  stepFocus,
} from "../src/motion-graph.ts";

interface El {
  id: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  points?: number[][];
  isDeleted?: boolean;
  version?: number;
  frameId?: string | null;
  containerId?: string | null;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  customData?: unknown;
}

let x = 0;
const node = (id: string, extra: Partial<El> = {}): El => {
  x += 200;
  return {
    id: `node/${id}`,
    type: "rectangle",
    x,
    y: 0,
    width: 100,
    height: 50,
    customData: { groundboard: { nodeId: id, kind: "step" } },
    ...extra,
  };
};
const label = (id: string): El => ({
  id: `label/${id}`,
  type: "text",
  containerId: `node/${id}`,
});
const edge = (id: string, from: string, to: string, extra: Partial<El> = {}): El => ({
  id: `edge/${id}`,
  type: "arrow",
  x: 10,
  y: 20,
  points: [
    [0, 0],
    [30, 0],
    [30, 40],
  ],
  startBinding: { elementId: `node/${from}` },
  endBinding: { elementId: `node/${to}` },
  customData: { groundboard: { edgeId: id, kind: "next" } },
  ...extra,
});

const stepsOf = (elements: El[]) =>
  presentationSteps(readMotionGraph(elements)).map((s) => ({ nodes: s.nodes, arrows: s.arrows }));

describe("readMotionGraph", () => {
  it("reads nodes and arrows, with the flow from the start binding to the end", () => {
    const graph = readMotionGraph([
      node("a"),
      label("a"),
      node("b"),
      edge("e1", "a", "b"),
      { id: "edge-label/e1", type: "text", containerId: "edge/e1" },
    ]);
    expect(graph.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(graph.arrows).toHaveLength(1);
    const arrow = graph.arrows[0];
    expect(arrow).toMatchObject({ id: "e1", from: "a", to: "b" });
    expect(arrow?.points).toEqual([
      [10, 20],
      [40, 20],
      [40, 60],
    ]);
    expect(arrow?.box).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    expect(graph.owners.get("label/a")).toEqual({ kind: "node", id: "a" });
    expect(graph.owners.get("edge-label/e1")).toEqual({ kind: "edge", id: "e1" });
  });

  it("reads the `-` ids of older scenes", () => {
    const graph = readMotionGraph([
      { ...node("a"), id: "node-a" },
      { ...node("b"), id: "node-b" },
      {
        ...edge("e1", "a", "b"),
        id: "edge-e1",
        startBinding: { elementId: "node-a" },
        endBinding: { elementId: "node-b" },
      },
    ]);
    expect(graph.arrows.map((a) => [a.from, a.to])).toEqual([["a", "b"]]);
  });

  it("leaves out deleted elements, notes drawn over the board, and arrows without bindings", () => {
    const graph = readMotionGraph([
      node("a"),
      node("b"),
      node("gone", { isDeleted: true }),
      edge("e1", "a", "b", { isDeleted: true }),
      edge("e2", "a", "b", { endBinding: null }),
      edge("e3", "a", "gone"),
      { id: "note/1", type: "text", customData: { groundboard: { overlay: true, nodeId: "a" } } },
    ]);
    expect(graph.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(graph.arrows).toEqual([]);
    expect(graph.owners.has("note/1")).toBe(false);
    expect(graph.owners.has("edge/e2")).toBe(false);

    const whole = readMotionGraph(
      [node("a"), node("b"), edge("e1", "a", "b", { isDeleted: true })],
      { includeDeleted: true },
    );
    expect(whole.arrows.map((a) => a.id)).toEqual(["e1"]);
  });

  it("puts a control inside a screen's frame in the screen's unit", () => {
    const graph = readMotionGraph([
      node("home", { type: "frame" }),
      node("save", { frameId: "node/home" }),
      {
        id: "node/save/box",
        frameId: "node/home",
        customData: { groundboard: { nodeId: "save" } },
      },
      { id: "wire/loose", frameId: "node/home" },
      node("done", { type: "frame" }),
      edge("go", "save", "done"),
    ]);
    expect(graph.nodeById.get("save")?.unit).toBe("home");
    expect(graph.owners.get("node/save/box")).toEqual({ kind: "node", id: "save" });
    expect(graph.owners.get("wire/loose")).toEqual({ kind: "node", id: "home" });
  });

  it("gives a marker for a screen on another board to the control it starts from", () => {
    const data = { groundboard: { edgeId: "out", kind: "navigates", from: "a" } };
    const graph = readMotionGraph([
      node("a"),
      { id: "ref-tag/out", customData: data },
      { id: "ref-line/out", customData: data },
      { id: "refimg/s/tag/out", customData: data },
    ]);
    expect(graph.owners.get("ref-tag/out")).toEqual({ kind: "node", id: "a" });
    expect(graph.owners.get("ref-line/out")).toEqual({ kind: "node", id: "a" });
    // No node "s" here: a reference mark is owned only by a screen of the board.
    expect(graph.owners.has("refimg/s/tag/out")).toBe(false);
  });

  it("gives a screen's reference image and its marks to the screen", () => {
    const graph = readMotionGraph([
      node("home", { type: "frame" }),
      { id: "refimg/home", type: "image" },
      { id: "refimg/home/tag/go", customData: { groundboard: { edgeId: "go" } } },
      { id: "refimg/legend-label/reference" },
    ]);
    expect(graph.nodes.map((n) => n.id)).toEqual(["home"]);
    expect(graph.owners.get("refimg/home")).toEqual({ kind: "node", id: "home" });
    expect(graph.owners.get("refimg/home/tag/go")).toEqual({ kind: "node", id: "home" });
    expect(graph.owners.has("refimg/legend-label/reference")).toBe(false);
    expect(readMotionGraph([node("home")], { owners: false }).owners.size).toBe(0);
  });
});

describe("selectedBoardItems and arrowsTouching", () => {
  const elements = [
    node("a"),
    node("b"),
    node("c"),
    { id: "node/a/action", customData: { groundboard: { nodeId: "a" } } },
    edge("ab", "a", "b"),
    edge("bc", "b", "c"),
    edge("ca", "c", "a"),
  ];
  const graph = readMotionGraph(elements);

  it("reads the selected nodes and edges from any of their elements", () => {
    expect(selectedBoardItems(elements, { "node/a/action": true, "edge/bc": true })).toEqual({
      nodes: ["a"],
      edges: ["bc"],
      operands: [],
    });
  });

  it("finds the arrows into and out of a node, and the nodes at their ends", () => {
    const touching = arrowsTouching(graph, ["a"], []);
    expect(touching.arrows.map((a) => a.id)).toEqual(["ab", "ca"]);
    expect(touching.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("adds an arrow selected on its own", () => {
    const touching = arrowsTouching(graph, [], ["bc"]);
    expect(touching.arrows.map((a) => a.id)).toEqual(["bc"]);
    expect(touching.nodes.map((n) => n.id)).toEqual(["b", "c"]);
  });

  it("finds nothing for an empty selection", () => {
    expect(arrowsTouching(graph, [], [])).toEqual({ arrows: [], nodes: [] });
  });

  it("tells whether two boxes overlap", () => {
    const view = { x: 0, y: 0, width: 100, height: 100 };
    expect(intersects(view, { x: 90, y: 90, width: 50, height: 50 })).toBe(true);
    expect(intersects(view, { x: 101, y: 0, width: 5, height: 5 })).toBe(false);
  });
});

describe("presentationSteps", () => {
  it("walks a straight flow one node at a time", () => {
    expect(
      stepsOf([node("a"), node("b"), node("c"), edge("e1", "a", "b"), edge("e2", "b", "c")]),
    ).toEqual([
      { nodes: ["a"], arrows: [] },
      { nodes: ["b"], arrows: ["e1"] },
      { nodes: ["c"], arrows: ["e2"] },
    ]);
  });

  it("shows the branches of a node together, in scene order", () => {
    const steps = stepsOf([
      node("a"),
      node("c"),
      node("b"),
      edge("ab", "a", "b"),
      edge("ac", "a", "c"),
    ]);
    expect(steps).toEqual([
      { nodes: ["a"], arrows: [] },
      { nodes: ["c", "b"], arrows: ["ab", "ac"] },
    ]);
  });

  it("keeps scene order among several roots", () => {
    const steps = stepsOf([
      node("y"),
      node("x"),
      node("z"),
      edge("1", "x", "z"),
      edge("2", "y", "z"),
    ]);
    expect(steps[0]?.nodes).toEqual(["y", "x"]);
    expect(steps[1]).toEqual({ nodes: ["z"], arrows: ["1", "2"] });
  });

  it("shows a back edge of a loop with the later of its ends", () => {
    const steps = stepsOf([
      node("a"),
      node("b"),
      node("c"),
      edge("ab", "a", "b"),
      edge("bc", "b", "c"),
      edge("cb", "c", "b"),
    ]);
    expect(steps).toEqual([
      { nodes: ["a"], arrows: [] },
      { nodes: ["b"], arrows: ["ab"] },
      { nodes: ["c"], arrows: ["bc", "cb"] },
    ]);
  });

  it("starts a closed loop with no root at its first node in scene order", () => {
    const steps = stepsOf([node("q"), node("p"), edge("qp", "q", "p"), edge("pq", "p", "q")]);
    expect(steps).toEqual([
      { nodes: ["q"], arrows: [] },
      { nodes: ["p"], arrows: ["qp", "pq"] },
    ]);
  });

  it("starts a closed loop after the rooted part is done", () => {
    const steps = stepsOf([
      node("a"),
      node("b"),
      node("q"),
      node("p"),
      edge("ab", "a", "b"),
      edge("qp", "q", "p"),
      edge("pq", "p", "q"),
    ]);
    expect(steps.map((s) => s.nodes)).toEqual([["a"], ["b"], ["q"], ["p"]]);
  });

  it("shows a self loop with its node, and lone nodes last", () => {
    const steps = stepsOf([
      node("lone"),
      node("a"),
      node("b"),
      edge("aa", "a", "a"),
      edge("ab", "a", "b"),
    ]);
    expect(steps).toEqual([
      { nodes: ["a"], arrows: ["aa"] },
      { nodes: ["b"], arrows: ["ab"] },
      { nodes: ["lone"], arrows: [] },
    ]);
  });

  it("has no steps for an empty scene, and one for a board without arrows", () => {
    expect(stepsOf([])).toEqual([]);
    expect(stepsOf([node("a"), node("b")])).toEqual([{ nodes: ["a", "b"], arrows: [] }]);
  });

  it("walks screens, not the controls on them", () => {
    const steps = stepsOf([
      node("home", { type: "frame" }),
      node("save", { frameId: "node/home" }),
      node("done", { type: "frame" }),
      edge("go", "save", "done"),
    ]);
    expect(steps).toEqual([
      { nodes: ["home"], arrows: [] },
      { nodes: ["done"], arrows: ["go"] },
    ]);
  });
});

describe("hiddenAtStep and sceneAtStep", () => {
  const elements: El[] = [
    { id: "title", type: "text" },
    node("a"),
    label("a"),
    node("b"),
    label("b"),
    { id: "node/b/action", customData: { groundboard: { nodeId: "b" } } },
    node("c"),
    edge("ab", "a", "b"),
    { id: "edge-label/ab", type: "text", containerId: "edge/ab" },
    { id: "edge/ab/spec", customData: { groundboard: { edgeId: "ab" } } },
    edge("bc", "b", "c", { isDeleted: true }),
  ];
  const graph = readMotionGraph(elements, { includeDeleted: true });
  const steps = presentationSteps(graph);

  it("hides the nodes and edges of later steps with their parts", () => {
    expect([...hiddenAtStep(graph, steps, 0)].sort()).toEqual(
      [
        "edge-label/ab",
        "edge/ab",
        "edge/ab/spec",
        "edge/bc",
        "label/b",
        "node/b",
        "node/b/action",
        "node/c",
      ].sort(),
    );
    expect([...hiddenAtStep(graph, steps, 2)]).toEqual([]);
  });

  it("puts back the very scene it started from at the last step", () => {
    const first = sceneAtStep(elements, hiddenAtStep(graph, steps, 0));
    expect(first.find((e) => e.id === "node/b")).toMatchObject({ isDeleted: true });
    expect(first.find((e) => e.id === "title")).toBe(elements[0]);
    // An element hidden by a layer before the presentation is never touched.
    expect(first.find((e) => e.id === "edge/bc")).toBe(elements[10]);
    const last = sceneAtStep(elements, hiddenAtStep(graph, steps, steps.length - 1));
    for (const [i, element] of last.entries()) expect(element).toBe(elements[i]);
  });

  it("frames a step's new nodes and the nodes its arrows start from", () => {
    expect(stepFocus(graph, steps[1]).map((n) => n.id)).toEqual(["a", "b"]);
    expect(stepFocus(graph, undefined)).toEqual([]);
  });
});

describe("a presentation over hidden layers", () => {
  it("leaves the scene as it found it, with the arrows layer still hidden", async () => {
    const { withLayersHidden } = await import("../src/layers.ts");
    const board: El[] = [
      node("a"),
      node("b"),
      edge("ab", "a", "b"),
      { id: "edge-label/ab", type: "text", containerId: "edge/ab" },
    ];
    const start = withLayersHidden(board, new Set(["arrows"] as const));
    const graph = readMotionGraph(start, { includeDeleted: true });
    const steps = presentationSteps(graph);
    expect(steps.map((s) => s.nodes)).toEqual([["a"], ["b"]]);
    const first = sceneAtStep(start, hiddenAtStep(graph, steps, 0));
    expect(first.find((e) => e.id === "node/b")).toMatchObject({ isDeleted: true });
    // Hidden by the layer before the presentation: the very same element, still hidden.
    expect(first.find((e) => e.id === "edge/ab")).toBe(start[2]);
    const last = sceneAtStep(start, hiddenAtStep(graph, steps, steps.length - 1));
    expect(last).toEqual(start);
    for (const [i, element] of last.entries()) expect(element).toBe(start[i]);
  });
});

describe("a presentation of a sequence board", () => {
  it("shows every participant, then one message per step, each fragment with its first message", async () => {
    const { sequenceBoard } = await import("../../../packages/schema/test/sequence-board.ts");
    const { renderBoardLocally } = await import("../src/local-render.ts");
    const { stepTargets } = await import("../src/motion-graph.ts");
    const result = await renderBoardLocally(sequenceBoard());
    if (result.status !== "ok") throw new Error(JSON.stringify(result));
    const elements = (result.scene as { elements: El[] }).elements;
    const graph = readMotionGraph(elements);
    expect(graph.sequence).toBe(true);
    expect(graph.arrows.map((a) => [a.id, a.from, a.to, a.number])).toEqual([
      ["m1", "user", "api", 1],
      ["m2", "api", "bank", 2],
      ["m3", "bank", "api", 3],
      ["m4", "api", "db", 4],
      ["m5", "api", "db", 5],
      ["m6", "api", "q", 6],
      ["m7", "api", "user", 7],
    ]);
    const steps = presentationSteps(graph);
    expect(steps).toHaveLength(8);
    expect(steps[0]).toEqual({ nodes: ["user", "api", "bank", "db", "q"], arrows: [] });
    expect(steps.slice(1).map((s) => s.arrows)).toEqual([
      ["m1"],
      ["m2"],
      ["m3"],
      ["m4"],
      ["m5"],
      ["m6"],
      ["m7"],
    ]);
    // Before message 4 the alt is hidden; its declined branch waits for message 7.
    const atThree = hiddenAtStep(graph, steps, 3);
    for (const id of ["fragment/pay", "fragment-tag/pay", "operand-guard/ok", "edge/m4"]) {
      expect(atThree.has(id), id).toBe(true);
    }
    expect(atThree.has("lifeline/api")).toBe(false);
    const atFour = hiddenAtStep(graph, steps, 4);
    expect(atFour.has("fragment/pay")).toBe(false);
    expect(atFour.has("fragment/lines")).toBe(true);
    expect(atFour.has("operand-line/declined")).toBe(true);
    expect(hiddenAtStep(graph, steps, 7).size).toBe(0);
    // The camera frames the message each step adds.
    expect(stepTargets(graph, steps[2])).toEqual(["edge/m2"]);
    expect(stepTargets(graph, steps[0]).sort()).toEqual(
      ["node/api", "node/bank", "node/db", "node/q", "node/user"].sort(),
    );
  });
});
