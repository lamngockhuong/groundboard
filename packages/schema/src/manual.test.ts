import { describe, expect, test } from "vitest";
import { boardClaims, countGrounding } from "./grounding.ts";
import { parseBoard } from "./validate.ts";

const base = () => ({
  schemaVersion: 1,
  title: "Checkout",
  question: "How does checkout work?",
  nodes: [
    { id: "a", kind: "step", label: "Submit the form", sourceIds: ["s"] },
    { id: "b", kind: "step", label: "Call the API", sourceIds: ["s"] },
  ],
  edges: [{ id: "e", from: "a", to: "b" }],
  sources: [{ id: "s", path: "src/a.ts", line: 1, quote: "submit()" }],
});

describe("claims a person added or reworded", () => {
  test("a grounded node without sources is valid when manual, and counts as none", () => {
    const board = base();
    board.nodes.push({ id: "m", kind: "step", label: "Added by hand", manual: true } as never);
    const parsed = parseBoard(board);
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (!parsed.ok) return;
    const claims = boardClaims(parsed.value);
    expect(claims.find((c) => c.id === "m")).toMatchObject({ grounding: "none", manual: true });
    expect(countGrounding(claims)).toEqual({ code: 2, spec: 0, none: 1 });
  });

  test("the same node without manual is refused", () => {
    const board = base();
    board.nodes.push({ id: "m", kind: "step", label: "Added by hand" } as never);
    expect(parseBoard(board).ok).toBe(false);
  });

  test("a reworded claim keeps its old sources as prior, and counts as none even if it cites", () => {
    const board = base();
    board.nodes[1] = {
      ...board.nodes[1],
      label: "Call the API twice",
      sourceIds: [],
      manual: true,
      priorSourceIds: ["s"],
    } as never;
    const parsed = parseBoard(board);
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (parsed.ok) expect(parsed.value.nodes[1]?.priorSourceIds).toEqual(["s"]);
  });

  test("priorSourceIds without manual, or naming no source, is refused", () => {
    const dropped = base();
    dropped.nodes[1] = { ...dropped.nodes[1], priorSourceIds: ["s"] } as never;
    const result = parseBoard(dropped);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.path).toBe("nodes[1].priorSourceIds");

    const missing = base();
    missing.nodes[1] = { ...missing.nodes[1], manual: true, priorSourceIds: ["gone"] } as never;
    const second = parseBoard(missing);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error[0]?.path).toBe("nodes[1].priorSourceIds[0]");
  });

  test("a manual navigates edge needs no source and counts as none", () => {
    const board = {
      schemaVersion: 1,
      title: "Screens",
      question: "Which screens?",
      nodes: [
        {
          id: "a",
          kind: "screen",
          label: "A",
          ref: "web:a",
          platform: "web",
          layoutFrom: "doc",
          manual: true,
        },
        {
          id: "b",
          kind: "screen",
          label: "B",
          ref: "web:b",
          platform: "web",
          layoutFrom: "doc",
          manual: true,
        },
      ],
      edges: [{ id: "go", from: "a", to: "b", kind: "navigates", manual: true }],
    };
    const parsed = parseBoard(board);
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (parsed.ok) {
      expect(boardClaims(parsed.value).map((c) => [c.id, c.grounding])).toEqual([
        ["a", "none"],
        ["b", "none"],
        ["go", "none"],
      ]);
    }
  });

  test("a reader that does not know manual sees a claim without sources, and refuses it", () => {
    // groundboard 0.1.0-rc.0 parses with plain objects: unknown fields are dropped silently.
    const board = base();
    board.nodes[1] = {
      ...board.nodes[1],
      label: "Call the API twice",
      sourceIds: [],
      manual: true,
      priorSourceIds: ["s"],
    } as never;
    const {
      manual: _m,
      priorSourceIds: _p,
      ...asOldReadersSeeIt
    } = board.nodes[1] as never as Record<string, unknown>;
    board.nodes[1] = asOldReadersSeeIt as never;
    const result = parseBoard(board);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.message).toContain("has no sourceIds");
  });
});
