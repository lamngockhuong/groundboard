import { describe, expect, test } from "vitest";
import { boardClaims, countGrounding } from "./grounding.ts";
import { screenFamilies } from "./states.ts";
import { type Issue, parseBoard } from "./validate.ts";

// biome-ignore lint/suspicious/noExplicitAny: test boards are mutated freely to build bad inputs
function wizard(): Record<string, any> {
  return {
    schemaVersion: 1,
    title: "Upload screen",
    question: "What is on the upload screen?",
    nodes: [
      {
        id: "upload",
        kind: "screen",
        label: "① Upload",
        ref: "web:upload",
        platform: "web",
        layoutFrom: "code",
        sourceIds: ["route"],
      },
      {
        id: "pick",
        kind: "element",
        role: "button",
        label: "Choose file",
        parentId: "upload",
        ref: "web:upload/choose-file",
        action: "Validates the file",
        sourceIds: ["pick"],
      },
      {
        id: "confirm",
        kind: "screen",
        label: "② Confirm",
        stateOf: "upload",
        sourceIds: ["step2"],
      },
      {
        id: "run",
        kind: "element",
        role: "button",
        label: "Run",
        parentId: "confirm",
        ref: "web:upload/run",
        action: "Opens the dialog",
        sourceIds: ["run"],
      },
      { id: "dialog", kind: "screen", label: "③ Dialog", stateOf: "upload", sourceIds: ["dlg"] },
      { id: "q", kind: "question", label: "Who approves? (Product)" },
    ],
    edges: [
      { id: "t1", from: "pick", to: "confirm", kind: "transition", sourceIds: ["set2"] },
      { id: "t2", from: "run", to: "dialog", kind: "transition", sourceIds: ["open"] },
      { id: "t3", from: "dialog", to: "upload", kind: "transition", sourceIds: ["reset"] },
    ],
    sources: [
      { id: "route", path: "src/main.tsx", line: 1, quote: "/upload" },
      { id: "pick", path: "src/Upload.tsx", line: 10, quote: "onPick" },
      { id: "step2", path: "src/Upload.tsx", line: 20, quote: "case 'confirm'" },
      { id: "run", path: "src/Upload.tsx", line: 21, quote: "onRun" },
      { id: "dlg", path: "src/Upload.tsx", line: 30, quote: "<Dialog" },
      { id: "set2", path: "src/Upload.tsx", line: 11, quote: "setStep('confirm')" },
      { id: "open", path: "src/Upload.tsx", line: 22, quote: "setOpen(true)" },
      { id: "reset", path: "src/Upload.tsx", line: 31, quote: "setStep('upload')" },
    ],
  };
}

function issuesOf(input: unknown): Issue[] {
  const result = parseBoard(input);
  return result.ok ? [] : result.error;
}

function expectOneIssue(input: unknown, path: string, pattern: RegExp): void {
  const issues = issuesOf(input);
  expect(issues, JSON.stringify(issues)).toHaveLength(1);
  expect(issues[0]?.path).toBe(path);
  expect(issues[0]?.message).toMatch(pattern);
}

const nodeIndex = (b: ReturnType<typeof wizard>, id: string): number =>
  b.nodes.findIndex((n: { id: string }) => n.id === id);

describe("screen states", () => {
  test("accepts states without refs and fills in the root's platform and layoutFrom", () => {
    const result = parseBoard(wizard());
    expect(result.ok, JSON.stringify(result.ok ? null : result.error)).toBe(true);
    if (!result.ok) return;
    const confirm = result.value.nodes.find((n) => n.id === "confirm");
    expect(confirm?.platform).toBe("web");
    expect(confirm?.layoutFrom).toBe("code");
    expect(screenFamilies(result.value)).toEqual(new Map([["upload", ["confirm", "dialog"]]]));
  });

  test("accepts a state that repeats the root's platform and layoutFrom", () => {
    const b = wizard();
    Object.assign(b.nodes[nodeIndex(b, "confirm")], { platform: "web", layoutFrom: "code" });
    expect(issuesOf(b)).toEqual([]);
  });

  test("counts transitions to a screen as claims, and not transitions between states", () => {
    const result = parseBoard(wizard());
    if (!result.ok) throw new Error("invalid");
    const claims = boardClaims(result.value);
    expect(claims.filter((c) => c.on === "edge").map((c) => c.id)).toEqual(["t1", "t2", "t3"]);
    expect(countGrounding(claims)).toEqual({ code: 8, spec: 0, none: 0 });
  });

  test("rejects stateOf naming a missing node", () => {
    const b = wizard();
    b.nodes[nodeIndex(b, "confirm")].stateOf = "nope";
    expectOneIssue(b, "nodes[2].stateOf", /stateOf `nope`, which is not a node id/);
  });

  test("rejects stateOf naming a node that is not a screen", () => {
    const b = wizard();
    b.nodes[nodeIndex(b, "dialog")].stateOf = "q";
    expectOneIssue(b, "nodes[4].stateOf", /a `question` node; stateOf names the screen/);
  });

  test("rejects a screen that is a state of itself", () => {
    const b = wizard();
    b.nodes[nodeIndex(b, "dialog")].stateOf = "dialog";
    expectOneIssue(b, "nodes[4].stateOf", /cannot be a state of itself/);
  });

  test("rejects a chain of states", () => {
    const b = wizard();
    b.nodes[nodeIndex(b, "dialog")].stateOf = "confirm";
    expectOneIssue(b, "nodes[4].stateOf", /itself a state of `upload`; states do not nest/);
  });

  test("rejects two screens that are states of each other", () => {
    const b = wizard();
    b.nodes[nodeIndex(b, "confirm")].stateOf = "dialog";
    b.nodes[nodeIndex(b, "dialog")].stateOf = "confirm";
    const issues = issuesOf(b);
    const stateOfIssues = issues.filter((i) => i.path.endsWith(".stateOf"));
    expect(stateOfIssues.map((i) => i.path)).toEqual(["nodes[2].stateOf", "nodes[4].stateOf"]);
    for (const issue of stateOfIssues) expect(issue.message).toMatch(/states do not nest/);
  });

  test("rejects a ref on a state", () => {
    const b = wizard();
    b.nodes[nodeIndex(b, "confirm")].ref = "web:upload-confirm";
    expectOneIssue(b, "nodes[2].ref", /state screen `confirm` must not have a ref/);
  });

  test("gives a state the root's width and rejects a different one", () => {
    const b = wizard();
    b.nodes[nodeIndex(b, "upload")].width = 1280;
    const result = parseBoard(b);
    expect(result.ok, JSON.stringify(result.ok ? null : result.error)).toBe(true);
    if (result.ok) expect(result.value.nodes.find((n) => n.id === "confirm")?.width).toBe(1280);
    b.nodes[nodeIndex(b, "confirm")].width = 1280;
    expect(issuesOf(b)).toEqual([]);
    b.nodes[nodeIndex(b, "confirm")].width = 1024;
    expectOneIssue(b, "nodes[2].width", /has width `1024` but its root `upload` has `1280`/);
  });

  test("rejects a width on a state whose root has none", () => {
    const b = wizard();
    b.nodes[nodeIndex(b, "confirm")].width = 5;
    expectOneIssue(b, "nodes[2].width", /has width 5 but its root `upload` has none/);
  });

  test("rejects a state whose platform or layoutFrom differs from the root's", () => {
    const b = wizard();
    b.nodes[nodeIndex(b, "confirm")].platform = "mobile";
    expectOneIssue(b, "nodes[2].platform", /has platform `mobile` but its root `upload` has `web`/);
    const c = wizard();
    c.nodes[nodeIndex(c, "confirm")].layoutFrom = "figma";
    expectOneIssue(c, "nodes[2].layoutFrom", /has layoutFrom `figma` but its root/);
  });

  test("rejects stateOf on a node that is not a screen", () => {
    const b = wizard();
    b.nodes[nodeIndex(b, "q")].stateOf = "upload";
    expectOneIssue(b, "nodes[5].stateOf", /stateOf is only allowed on `screen` nodes/);
  });

  test("rejects an element of a state whose ref is not under the root's ref", () => {
    const b = wizard();
    b.nodes[nodeIndex(b, "run")].ref = "web:upload-confirm/run";
    expectOneIssue(
      b,
      "nodes[3].ref",
      /belongs to state `confirm` of screen `web:upload`, so its ref must start with `web:upload\/`/,
    );
  });

  test("rejects a state drawn from code that cites no code source", () => {
    const b = wizard();
    b.nodes[nodeIndex(b, "dialog")].sourceIds = ["fig"];
    b.sources.push({ id: "fig", kind: "figma", fileKey: "AbCdEf0123456789", nodeId: "1:2" });
    expectOneIssue(b, "nodes[4].sourceIds", /drawn from code but cites no code source/);
  });

  test("rejects a transition to a state that cites no source that can back it", () => {
    const b = wizard();
    b.edges[1].sourceIds = [];
    expectOneIssue(
      b,
      "edges[1].sourceIds",
      /transition edge `t2` changes screen state but cites no source/,
    );
  });

  test("rejects a transition to a state from outside its screen", () => {
    const b = wizard();
    b.nodes.push({
      id: "other",
      kind: "screen",
      label: "Other",
      ref: "web:other",
      platform: "web",
      layoutFrom: "code",
      sourceIds: ["route"],
    });
    b.edges.push({
      id: "t4",
      from: "other",
      to: "confirm",
      kind: "transition",
      sourceIds: ["set2"],
    });
    expectOneIssue(b, "edges[3].to", /not that screen or one of its states; use navigates/);
  });

  test("rejects a transition to a state from a node that is not a screen or element", () => {
    const b = wizard();
    b.edges.push({ id: "t4", from: "q", to: "confirm", kind: "transition", sourceIds: ["set2"] });
    expectOneIssue(b, "edges[3].from", /starts at `question` node `q`/);
  });

  test("rejects navigates to a state, or to the root from one of its states", () => {
    const b = wizard();
    b.edges[0].kind = "navigates";
    expectOneIssue(b, "edges[0].kind", /a state of screen `upload`.*is a transition edge/);
    const c = wizard();
    c.edges[2].kind = "navigates";
    expectOneIssue(c, "edges[2].kind", /the root of screen `upload`, from within that screen/);
  });

  test("keeps transitions between state nodes unchecked", () => {
    const result = parseBoard({
      schemaVersion: 1,
      title: "t",
      question: "q?",
      nodes: [
        { id: "a", kind: "state", label: "A", sourceIds: ["s"] },
        { id: "b", kind: "state", label: "B", sourceIds: ["s"] },
      ],
      edges: [{ id: "e", from: "a", to: "b", kind: "transition" }],
      sources: [{ id: "s", path: "a.ts", line: 1, quote: "x" }],
    });
    expect(result.ok).toBe(true);
  });
});
