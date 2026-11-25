import { describe, expect, test } from "vitest";
import type { Board } from "./board.ts";
import { lintBoardText, lintDuplicateEdges } from "./lint-text.ts";

function board(label: string, extra: Partial<Board["nodes"][number]> = {}): Board {
  return {
    schemaVersion: 1,
    title: "t",
    question: "q",
    groups: [],
    nodes: [{ id: "n", kind: "note", label, sourceIds: [], ...extra }],
    edges: [],
    sources: [],
  };
}

describe("lintBoardText", () => {
  test.each([
    ["Contact jane.doe@example.com", /email address/],
    ["Card 4111 1111 1111 1111", /card number/],
    ["Call +84 912 345 678", /phone number/],
    ["Saved to /home/alice/shots/cart.png", /absolute local path/],
    ["Saved to C:\\Users\\alice", /absolute local path/],
    ["Copied from /Users/bob/Desktop/x.png", /absolute local path/],
    ["Run from /home/alice", /absolute local path/],
    ["cwd=/Users/bob", /absolute local path/],
  ])("warns about %s", (label, pattern) => {
    const warnings = lintBoardText(board(label));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^nodes\[0\]\.label /);
    expect(warnings[0]).toMatch(pattern);
  });

  test.each([
    "Customer email",
    "Total (VND)",
    "Order #1234",
    "Step 12 of 30",
    "src/cart.ts:12",
    'to: "/_authenticated/ineligible/home/"',
    'to: "/_authenticated/home/dashboard/"',
    'to: "/home/"',
    "Opens /home/ after sign-in",
  ])("does not warn about placeholder text %s", (label) => {
    expect(lintBoardText(board(label))).toEqual([]);
  });

  test("checks action and unresolved too", () => {
    const warnings = lintBoardText(board("Pay", { action: "emails bob@shop.io" }));
    expect(warnings[0]).toMatch(/^nodes\[0\]\.action /);
  });
});

describe("lintBoardText on sources", () => {
  const withSources = (sources: Board["sources"]): Board => ({ ...board("Pay"), sources });

  test("warns when a code source cites a document", () => {
    for (const path of ["docs/requirements.md", "README.md", "spec/notes.txt", "a/docs/x.ts"]) {
      const warnings = lintBoardText(
        withSources([{ id: "s", kind: "code", path, line: 1, quote: "x" }]),
      );
      expect(warnings, path).toHaveLength(1);
      expect(warnings[0]).toMatch(/^sources\[0\]\.path cites a document as code.*kind "doc"/);
    }
    expect(
      lintBoardText(
        withSources([{ id: "s", kind: "doc", path: "docs/a.md", line: 1, quote: "x" }]),
      ),
    ).toEqual([]);
    expect(
      lintBoardText(withSources([{ id: "s", kind: "code", path: "src/doc.ts", line: 1 }])),
    ).toEqual([]);
  });

  test("checks quotes, link titles and URLs, and mockup labels", () => {
    const warnings = lintBoardText(
      withSources([
        { id: "a", kind: "code", path: "src/a.ts", line: 1, quote: "send to bob@shop.io" },
        { id: "b", kind: "doc", path: "docs/a.md", line: 1, quote: "Call +84 912 345 678" },
        { id: "c", kind: "link", url: "https://x.example/u/jane%40example.com", title: "Doc" },
        { id: "d", kind: "link", url: "https://x.example/d", title: "Jane jane@example.com" },
        { id: "e", kind: "mockup", label: "Mockup for jane@example.com" },
      ]),
    );
    expect(warnings.map((w) => w.split(" ")[0])).toEqual([
      "sources[0].quote",
      "sources[1].quote",
      "sources[2].url",
      "sources[3].title",
      "sources[4].label",
    ]);
  });

  test("does not read a URL path like /home/ as a local path", () => {
    expect(
      lintBoardText(
        withSources([{ id: "c", kind: "link", url: "https://x.example/home/docs", title: "Doc" }]),
      ),
    ).toEqual([]);
  });
});

describe("lintDuplicateEdges", () => {
  const edge = (id: string, extra: Partial<Board["edges"][number]> = {}) => ({
    id,
    from: "a",
    to: "b",
    kind: "navigates" as const,
    label: "opens",
    sourceIds: [id],
    ...extra,
  });

  test("warns when an edge repeats an earlier one and names both", () => {
    const warnings = lintDuplicateEdges({ edges: [edge("e1"), edge("e2"), edge("e3")] });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^edges\[1\] \(`e2`\) repeats edges\[0\] \(`e1`\).*merge them/);
    expect(warnings[1]).toMatch(/^edges\[2\] \(`e3`\) repeats edges\[0\]/);
  });

  test("does not warn when the target, kind or label differs", () => {
    expect(
      lintDuplicateEdges({
        edges: [
          edge("e1"),
          edge("e2", { to: "c" }),
          edge("e3", { kind: "flow" }),
          edge("e4", { label: "back" }),
          edge("e5", { to: undefined, toRef: "web:b" }),
          edge("e6", { from: "c" }),
        ],
      }),
    ).toEqual([]);
  });

  test("reaches validate warnings through lintBoardText", () => {
    const b: Board = { ...board("Pay"), edges: [edge("e1"), edge("e2")] };
    b.nodes = [
      { id: "a", kind: "note", label: "A", sourceIds: [] },
      { id: "b", kind: "note", label: "B", sourceIds: [] },
    ];
    expect(lintBoardText(b)).toEqual([expect.stringMatching(/^edges\[1\] /)]);
  });
});
