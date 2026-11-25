import { describe, expect, test } from "vitest";
import { type BoardSource, SourceSchema } from "./board.ts";
import {
  boardClaims,
  countGrounding,
  groundingOf,
  isBehaviourSource,
  isCheckable,
  SOURCE_KINDS,
} from "./grounding.ts";
import { parseBoard } from "./validate.ts";

const code: BoardSource = { id: "c", kind: "code", path: "src/a.ts", line: 1, quote: "go()" };
const bareCode: BoardSource = { id: "c0", kind: "code", path: "src/a.ts", line: 2 };
const doc: BoardSource = { id: "d", kind: "doc", path: "docs/req.md", line: 3, quote: "Pay" };
const figma: BoardSource = { id: "f", kind: "figma", fileKey: "AbCdEf0123456789", nodeId: "1:2" };
const link: BoardSource = { id: "l", kind: "link", url: "https://x.example/doc", title: "Doc" };
const quotedLink: BoardSource = { ...link, id: "lq", quote: "Pay goes on" };
const mockup: BoardSource = { id: "m", kind: "mockup", label: "Mockup" };
const fileMockup: BoardSource = { ...mockup, id: "mp", path: "design/a.png" };
const all = [code, bareCode, doc, figma, link, quotedLink, mockup, fileMockup];
const sources = new Map(all.map((s) => [s.id, s]));

describe("SOURCE_KINDS", () => {
  test("has a row for every source kind the schema accepts, and no other", () => {
    for (const source of all) expect(SourceSchema.safeParse(source).success).toBe(true);
    expect(new Set(all.map((s) => s.kind))).toEqual(new Set(Object.keys(SOURCE_KINDS)));
    expect(SourceSchema.safeParse({ ...code, kind: "ticket" }).success).toBe(false);
  });

  test("puts only code in the code tier", () => {
    const codeTier = Object.entries(SOURCE_KINDS).filter(([, d]) => d.tier === "code");
    expect(codeTier.map(([kind]) => kind)).toEqual(["code"]);
  });

  test.each(all.map((s) => [s.id, s] as const))("classifies source %s without throwing", (_, s) => {
    expect(typeof isBehaviourSource(s)).toBe("boolean");
    expect(typeof isCheckable(s)).toBe("boolean");
  });
});

describe("isBehaviourSource and isCheckable", () => {
  test("backs behaviour with located sources only", () => {
    expect(all.filter(isBehaviourSource).map((s) => s.id)).toEqual(["c", "d", "f", "lq", "mp"]);
  });

  test("checks code, documents and committed mockups", () => {
    expect(all.filter(isCheckable).map((s) => s.id)).toEqual(["c", "c0", "d", "mp"]);
  });
});

describe("groundingOf", () => {
  test.each([
    [["c"], "code"],
    [["d", "c"], "code"],
    [["d"], "spec"],
    [["f", "m"], "spec"],
    [["c0"], "none"],
    [["c0", "l"], "spec"],
    [[], "none"],
    [["missing"], "none"],
  ])("%j is %s", (ids, expected) => {
    expect(groundingOf(ids, sources)).toBe(expected);
  });
});

describe("boardClaims", () => {
  const result = parseBoard({
    schemaVersion: 1,
    title: "t",
    question: "q",
    nodes: [
      {
        id: "s",
        kind: "screen",
        label: "S",
        ref: "web:s",
        platform: "web",
        layoutFrom: "figma",
        sourceIds: ["f"],
      },
      { id: "box", kind: "element", role: "container", label: "Box", parentId: "s" },
      {
        id: "pay",
        kind: "element",
        role: "button",
        label: "Pay",
        parentId: "box",
        action: "pays",
        sourceIds: ["c"],
      },
      {
        id: "help",
        kind: "element",
        role: "button",
        label: "Help",
        parentId: "box",
        action: "helps",
        sourceIds: ["d"],
      },
      {
        id: "x",
        kind: "element",
        role: "link",
        label: "X",
        parentId: "box",
        unresolved: "Ask design",
        sourceIds: ["c"],
      },
      { id: "hint", kind: "element", role: "text", label: "Hint", parentId: "box" },
      {
        id: "t",
        kind: "screen",
        label: "T",
        ref: "web:t",
        platform: "web",
        layoutFrom: "doc",
        sourceIds: ["d"],
      },
      { id: "why", kind: "question", label: "Who decides?" },
      { id: "n", kind: "note", label: "note" },
      { id: "fact", kind: "fact", label: "fact", sourceIds: ["c"] },
    ],
    edges: [
      { id: "e1", from: "help", to: "t", kind: "navigates", sourceIds: ["d"] },
      { id: "e2", from: "pay", toRef: "web:done", kind: "navigates", sourceIds: ["c"] },
      { id: "e3", from: "why", to: "help", kind: "relates" },
    ],
    sources: all,
  });

  test("lists screens, interactive elements, grounded kinds and navigates edges", () => {
    expect(result.ok, JSON.stringify(result.ok ? null : result.error)).toBe(true);
    if (!result.ok) return;
    const claims = boardClaims(result.value);
    expect(claims.map((c) => [c.path, c.id, c.on, c.grounding])).toEqual([
      ["nodes[0]", "s", "node", "spec"],
      ["nodes[2]", "pay", "node", "code"],
      ["nodes[3]", "help", "node", "spec"],
      ["nodes[4]", "x", "node", "none"],
      ["nodes[6]", "t", "node", "spec"],
      ["nodes[9]", "fact", "node", "code"],
      ["edges[0]", "e1", "edge", "spec"],
      ["edges[1]", "e2", "edge", "code"],
    ]);
    expect(countGrounding(claims)).toEqual({ code: 3, spec: 4, none: 1 });
  });

  test("leaves questions, notes and non-interactive elements out", () => {
    if (!result.ok) return;
    const ids = boardClaims(result.value).map((c) => c.id);
    for (const id of ["why", "n", "box", "hint", "e3"]) expect(ids).not.toContain(id);
  });
});
