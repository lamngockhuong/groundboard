import { describe, expect, it } from "vitest";
import {
  boardNodes,
  type CodeCitation,
  type DocCitation,
  elementForNode,
  formatLocation,
  isCheckedCitation,
  isCodeCitation,
  isStale,
  type LinkCitation,
  safeFigmaUrl,
  safeHttpsUrl,
  selectedCitations,
  selectedRefTarget,
} from "../src/sources.ts";

const node = {
  id: "node-n-ready",
  customData: {
    groundboard: {
      nodeId: "n-ready",
      kind: "step",
      detail: "Empty carts are refused.",
      sources: [
        { id: "s-1", path: "src/cart.ts", line: 4, endLine: 9, quote: "<b>if</b> (cart.empty)" },
        { id: "s-2", path: "src/cart.ts", line: 12 },
        { id: "bad", path: 3 },
      ],
    },
  },
};
const label = { id: "label-n-ready", containerId: "node-n-ready" };
const edge = { id: "edge-e1", customData: { groundboard: { edgeId: "e1", kind: "flow" } } };
const elements = [node, label, edge];

describe("selectedCitations", () => {
  it("returns the sources of a selected node and drops malformed ones", () => {
    const [result] = selectedCitations(elements, { "node-n-ready": true });
    expect(result?.nodeId).toBe("n-ready");
    expect(result?.detail).toBe("Empty carts are refused.");
    expect(result?.sources).toHaveLength(2);
    expect((result?.sources[0] as CodeCitation | undefined)?.quote).toBe("<b>if</b> (cart.empty)");
  });

  it("maps a selected bound label to its container, once", () => {
    const result = selectedCitations(elements, { "label-n-ready": true, "node-n-ready": true });
    expect(result).toHaveLength(1);
  });

  it("ignores edges, unselected and unknown ids", () => {
    expect(selectedCitations(elements, { "edge-e1": true })).toEqual([]);
    expect(selectedCitations(elements, { "node-n-ready": false })).toEqual([]);
    expect(selectedCitations(elements, { missing: true })).toEqual([]);
  });
});

describe("formatLocation", () => {
  it("formats single lines and ranges", () => {
    expect(formatLocation({ id: "a", path: "a.ts", line: 3 })).toBe("a.ts:3");
    expect(formatLocation({ id: "a", path: "a.ts", line: 3, endLine: 3 })).toBe("a.ts:3");
    expect(formatLocation({ id: "a", path: "a.ts", line: 3, endLine: 8 })).toBe("a.ts:3-8");
  });
});

// A wireframe as the renderer draws it: no group ids, a container two levels deep, marks that
// carry their element's data, a navigates arrow with sources and a chip.
const screenData = (nodeId: string, extra: Record<string, unknown> = {}) => ({
  groundboard: { nodeId, kind: "element", sources: [], ...extra },
});
const wire = [
  {
    id: "node-checkout",
    customData: {
      groundboard: {
        nodeId: "checkout",
        kind: "screen",
        ref: "web:checkout",
        layoutFrom: "figma",
        sources: [],
      },
    },
  },
  { id: "node-form", customData: screenData("form", { role: "container" }) },
  { id: "node-card", customData: screenData("card", { role: "container" }) },
  {
    id: "node-pay",
    customData: screenData("pay", {
      role: "button",
      ref: "web:checkout/pay-button",
      action: "submits the order",
      sources: [{ id: "h", path: "src/Checkout.tsx", line: 20, quote: "onPay" }],
    }),
  },
  { id: "label-pay", containerId: "node-pay" },
  { id: "node-pay-action", customData: screenData("pay", { role: "button" }) },
  {
    id: "edge-pay-done",
    customData: {
      groundboard: {
        edgeId: "pay-done",
        kind: "navigates",
        sources: [{ id: "nav", path: "src/Checkout.tsx", line: 22, quote: 'navigate("/done")' }],
      },
    },
  },
  {
    id: "edge-back",
    customData: { groundboard: { edgeId: "back", kind: "navigates", toRef: "web:cart" } },
  },
  {
    id: "node-fig",
    customData: {
      groundboard: {
        nodeId: "fig",
        kind: "screen",
        sources: [
          {
            id: "f1",
            kind: "figma",
            nodeId: "1:2",
            url: "https://www.figma.com/design/AbC?node-id=1-2",
          },
          { id: "f2", kind: "figma", nodeId: "3:4", url: "https://evil.example/design/AbC" },
        ],
      },
    },
  },
];

describe("selectedCitations on a wireframe", () => {
  it("selecting an element two containers deep shows only that element, with its action", () => {
    const result = selectedCitations(wire, { "node-pay": true });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      nodeId: "pay",
      role: "button",
      ref: "web:checkout/pay-button",
      action: "submits the order",
    });
  });

  it("counts a mark or a label of an element as the element, once", () => {
    const result = selectedCitations(wire, {
      "node-pay-action": true,
      "label-pay": true,
      "node-pay": true,
    });
    expect(result.map((r) => r.nodeId)).toEqual(["pay"]);
  });

  it("shows the code source of a selected navigates arrow, and the target of a toRef arrow", () => {
    const [arrow] = selectedCitations(wire, { "edge-pay-done": true });
    expect(arrow).toMatchObject({ edgeId: "pay-done", kind: "navigates" });
    expect(arrow?.sources.map(formatLocation)).toEqual(["src/Checkout.tsx:22"]);
    expect(selectedCitations(wire, { "edge-back": true })[0]?.toRef).toBe("web:cart");
  });

  it("counts the tag and the list line of a toRef edge as the edge, with its sources and target", () => {
    // As the renderer draws a toRef edge on a screen board: a tag, its number and a list line,
    // in one group, each carrying the edge's data.
    const groundboard = {
      edgeId: "back",
      kind: "navigates",
      toRef: "web:cart",
      sources: [{ id: "nav", path: "src/Checkout.tsx", line: 22, quote: "navigate" }],
    };
    const parts = ["ref-tag-back", "ref-tag-back-number", "ref-line-back"].map((id) => ({
      id,
      groupIds: ["ref-back"],
      customData: { groundboard },
    }));
    for (const part of parts) {
      const [one] = selectedCitations(parts, { [part.id]: true });
      expect(one).toMatchObject({ edgeId: "back", kind: "navigates", toRef: "web:cart" });
      expect(one?.sources.map(formatLocation)).toEqual(["src/Checkout.tsx:22"]);
    }
    // Selecting the group selects all three; the edge is listed once.
    const all = selectedCitations(parts, Object.fromEntries(parts.map((p) => [p.id, true])));
    expect(all.map((c) => c.edgeId)).toEqual(["back"]);
  });

  it("links a Figma source only when its URL is on www.figma.com", () => {
    const [fig] = selectedCitations(wire, { "node-fig": true });
    expect(fig?.sources).toEqual([
      {
        kind: "figma",
        id: "f1",
        nodeId: "1:2",
        url: "https://www.figma.com/design/AbC?node-id=1-2",
      },
      { kind: "figma", id: "f2", nodeId: "3:4" },
    ]);
    expect(formatLocation(fig?.sources[0] as never)).toBe("Figma 1:2");
    expect(safeFigmaUrl("javascript:alert(1)")).toBeNull();
    expect(safeFigmaUrl("http://www.figma.com/x")).toBeNull();
    expect(safeFigmaUrl("https://user@www.figma.com/x")).toBeNull();
    expect(safeFigmaUrl("https://:pw@www.figma.com/x")).toBeNull();
    expect(safeFigmaUrl("https://www.figma.com:8443/x")).toBeNull();
  });

  it("finds the main element of a node for a deep link", () => {
    expect(elementForNode(wire, "pay")?.id).toBe("node-pay");
    const current = [
      { id: "node/pay/action", customData: screenData("pay", { role: "button" }) },
      { id: "node/pay", customData: screenData("pay", { role: "button" }) },
    ];
    expect(elementForNode(current, "pay")?.id).toBe("node/pay");
    expect(elementForNode(wire, "nope")).toBeNull();
  });
});

describe("specification sources and grounding", () => {
  const element = (data: Record<string, unknown>, id = "node-x") => ({
    id,
    customData: { groundboard: { nodeId: id.replace(/^node-/, ""), ...data } },
  });
  const read = (data: Record<string, unknown>) =>
    selectedCitations([element(data)], { "node-x": true })[0];

  it("parses all five kinds and never reads a doc source as code", () => {
    const result = read({
      kind: "element",
      action: "pays",
      grounding: "spec",
      sources: [
        { id: "c", path: "src/a.ts", line: 1, quote: "pay()" },
        { id: "f", kind: "figma", nodeId: "1:2" },
        {
          id: "d",
          kind: "doc",
          path: "docs/r.md",
          line: 3,
          quote: "Pay submits",
          url: "https://github.com/o/r/blob/abc1234/docs/r.md#L3",
        },
        { id: "l", kind: "link", url: "https://docs.example.com/spec", title: "Spec", quote: "q" },
        { id: "m", kind: "mockup", label: "Mockup", path: "design/a.png" },
        { id: "z", kind: "ticket", path: "x", line: 1 },
      ],
    });
    expect(result?.sources.map((c) => c.kind ?? "code")).toEqual([
      "code",
      "figma",
      "doc",
      "link",
      "mockup",
    ]);
    const doc = result?.sources[2] as DocCitation;
    expect(doc).toMatchObject({ kind: "doc", path: "docs/r.md", line: 3 });
    expect(isCodeCitation(doc)).toBe(false);
    expect(doc.url).toBe("https://github.com/o/r/blob/abc1234/docs/r.md#L3");
    expect(result?.sources.map(formatLocation)).toEqual([
      "src/a.ts:1",
      "Figma 1:2",
      "docs/r.md:3",
      "Link Spec",
      "Mockup design/a.png",
    ]);
    expect(result?.sources.map(isCheckedCitation)).toEqual([true, false, true, false, true]);
    expect((result?.sources[3] as LinkCitation | undefined)?.host).toBe("docs.example.com");
  });

  it("links a link, doc or mockup only for a plain https URL", () => {
    const result = read({
      kind: "screen",
      sources: [
        { id: "a", kind: "link", url: "javascript:alert(1)", title: "A" },
        { id: "b", kind: "link", url: "http://docs.example.com/b", title: "B" },
        { id: "c", kind: "link", url: "https://u:p@docs.example.com/c", title: "C" },
        { id: "d", kind: "doc", path: "d.md", line: 1, url: "javascript:alert(1)" },
        { id: "e", kind: "mockup", label: "E", url: "data:text/html,x" },
      ],
    });
    for (const source of result?.sources ?? []) {
      expect("url" in source ? source.url : undefined, source.id).toBeUndefined();
    }
    expect((result?.sources[0] as LinkCitation | undefined)?.host).toBeNull();
    expect(safeHttpsUrl("https://docs.example.com/x?y=1")).toBe("https://docs.example.com/x?y=1");
  });

  it("reads the grounding the renderer recorded, and guesses none", () => {
    expect(read({ kind: "element", action: "a", grounding: "spec", sources: [] })?.grounding).toBe(
      "spec",
    );
    expect(read({ kind: "step", grounding: "code", sources: [] })?.grounding).toBe("code");
    // An unknown value, or none at all, is not turned into a grounding by the viewer.
    expect(
      read({
        kind: "element",
        action: "a",
        grounding: "bogus",
        sources: [{ id: "c", path: "a.ts", line: 1, quote: "x" }],
      })?.grounding,
    ).toBeUndefined();
    expect(
      read({ kind: "step", sources: [{ id: "c", path: "a.ts", line: 1, quote: "x" }] })?.grounding,
    ).toBeUndefined();
  });

  it("reads a claim a person changed: manual, and the sources it cited before", () => {
    const read1 = read({
      kind: "step",
      grounding: "none",
      manual: true,
      sources: [],
      priorSources: [{ id: "c", path: "a.ts", line: 1, quote: "x" }],
    });
    expect(read1).toMatchObject({ grounding: "none", manual: true });
    expect(read1?.priorSources).toEqual([{ id: "c", path: "a.ts", line: 1, quote: "x" }]);
    // Prior sources mean nothing on a claim that is not manual.
    expect(
      read({ kind: "step", grounding: "code", priorSources: [{ id: "c", path: "a.ts", line: 1 }] })
        ?.priorSources,
    ).toBeUndefined();
  });

  it("gives no grounding to notes, questions and elements that are only drawn", () => {
    expect(read({ kind: "note", sources: [] })?.grounding).toBeUndefined();
    expect(read({ kind: "question", sources: [] })?.grounding).toBeUndefined();
    expect(read({ kind: "element", role: "container", sources: [] })?.grounding).toBeUndefined();
  });

  it("gives a navigates arrow a grounding, and a relates arrow none", () => {
    const arrows = [
      {
        id: "edge-a",
        customData: {
          groundboard: {
            edgeId: "a",
            kind: "navigates",
            grounding: "spec",
            sources: [{ id: "d", kind: "doc", path: "d.md", line: 1, quote: "q" }],
          },
        },
      },
      {
        id: "edge-b",
        customData: {
          groundboard: {
            edgeId: "b",
            kind: "relates",
            sources: [{ id: "c", path: "a.ts", line: 1 }],
          },
        },
      },
    ];
    const [a, b] = selectedCitations(arrows, { "edge-a": true, "edge-b": true });
    expect(a?.grounding).toBe("spec");
    expect(b?.grounding).toBeUndefined();
  });
});

describe("isStale", () => {
  it("marks a source whose id the board check listed", () => {
    const stale = new Set(["s-1"]);
    expect(isStale({ id: "s-1", path: "a.ts", line: 1 }, stale)).toBe(true);
    expect(isStale({ id: "s-2", path: "a.ts", line: 1 }, stale)).toBe(false);
  });

  it("never marks a source without an id, nor anything on a board with no check", () => {
    expect(isStale({ id: "", path: "a.ts", line: 1 }, new Set([""]))).toBe(false);
    expect(isStale({ id: "s-1", path: "a.ts", line: 1 }, new Set())).toBe(false);
  });
});

describe("boardNodes", () => {
  it("lists each node once with its label, kind and first source, and skips arrows", () => {
    const mark = { id: "mark-n-ready", customData: node.customData };
    const labelled = [node, { ...label, text: "Cart\n is  ready" }, mark, edge];
    expect(boardNodes(labelled)).toEqual([
      { nodeId: "n-ready", kind: "step", label: "Cart is ready", location: "src/cart.ts:4-9" },
    ]);
  });

  it("leaves deleted elements out and has no location without sources", () => {
    const bare = { id: "node-q", customData: { groundboard: { nodeId: "q", kind: "question" } } };
    const gone = { ...node, isDeleted: true };
    expect(boardNodes([gone, bare])).toEqual([
      { nodeId: "q", kind: "question", label: "", location: null },
    ]);
  });
});

describe("selectedRefTarget", () => {
  const marker = (id: string, edgeId: string, toRef: string) => ({
    id,
    customData: { groundboard: { edgeId, kind: "navigates", toRef, sources: [] } },
  });
  const scene = [
    marker("ref-tag-a", "a", "web:login"),
    marker("ref-tag-a-number", "a", "web:login"),
    marker("ref-line-a", "a", "web:login"),
    marker("ref-line-b", "b", "web:cart"),
    node,
    edge,
  ];

  it("names the ref of one selected toRef edge, whichever of its parts is selected", () => {
    const all = { "ref-tag-a": true, "ref-tag-a-number": true, "ref-line-a": true };
    expect(selectedRefTarget(scene, all)).toBe("web:login");
    expect(selectedRefTarget(scene, { "ref-line-b": true })).toBe("web:cart");
  });

  it("is null for nothing selected, two edges, or anything else in the selection", () => {
    expect(selectedRefTarget(scene, {})).toBeNull();
    expect(selectedRefTarget(scene, { "ref-line-a": true, "ref-line-b": true })).toBeNull();
    expect(selectedRefTarget(scene, { "ref-line-a": true, "node-n-ready": true })).toBeNull();
    expect(selectedRefTarget(scene, { "edge-e1": true })).toBeNull();
    expect(selectedRefTarget(scene, { "ref-line-a": false })).toBeNull();
  });
});

describe("selected labels", () => {
  const nav = {
    id: "node-lay-nav-reports",
    customData: { groundboard: { nodeId: "lay-nav-reports", kind: "element", role: "link" } },
  };
  const navText = {
    id: "label-lay-nav-reports",
    containerId: "node-lay-nav-reports",
    text: "  通知書\n ",
  };
  const tag = {
    id: "ref-tag-to-reports",
    customData: {
      groundboard: {
        edgeId: "to-reports",
        from: "lay-nav-reports",
        kind: "navigates",
        toRef: "web:reports",
      },
    },
  };
  const arrow = {
    id: "edge-e2",
    customData: { groundboard: { edgeId: "e2", kind: "navigates", toRef: "web:x" } },
  };
  const arrowText = { id: "edge-label-e2", containerId: "edge-e2", text: "Save" };
  const scene = [nav, navText, tag, arrow, arrowText];

  it("names a node by its text and a navigation by the control it starts from", () => {
    const [byNode] = selectedCitations(scene, { "label-lay-nav-reports": true });
    expect(byNode?.label).toBe("通知書");
    const [byTag] = selectedCitations(scene, { "ref-tag-to-reports": true });
    expect(byTag).toMatchObject({ from: "lay-nav-reports", fromLabel: "通知書" });
    expect(byTag?.label).toBeUndefined();
  });

  it("names an arrow by its own label", () => {
    const [byArrow] = selectedCitations(scene, { "edge-e2": true });
    expect(byArrow?.label).toBe("Save");
  });

  it("cuts a very long label", () => {
    const long = [{ ...nav }, { ...navText, text: "x".repeat(300) }];
    const [result] = selectedCitations(long, { "node-lay-nav-reports": true });
    expect(result?.label).toHaveLength(120);
    expect(result?.label?.endsWith("…")).toBe(true);
  });
});
