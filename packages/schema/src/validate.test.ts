import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { boardJsonSchemaText } from "./json-schema.ts";
import { LIMITS } from "./limits.ts";
import { type Issue, parseBoard } from "./validate.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const examples = ["checkout-flow.board.json", "order-state-machine.board.json"];

function loadExample(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8"));
}

// biome-ignore lint/suspicious/noExplicitAny: test boards are mutated freely to build bad inputs
function base(): Record<string, any> {
  return {
    schemaVersion: 1,
    title: "t",
    question: "q?",
    groups: [{ id: "g1", label: "G" }],
    nodes: [
      { id: "n1", kind: "step", label: "one", groupId: "g1", sourceIds: ["s1"] },
      { id: "n2", kind: "note", label: "two" },
    ],
    edges: [{ id: "e1", from: "n1", to: "n2", kind: "flow" }],
    sources: [{ id: "s1", path: "src/a.ts", line: 1, quote: "x" }],
  };
}

function issuesOf(input: unknown): Issue[] {
  const result = parseBoard(input);
  return result.ok ? [] : result.error;
}

function expectOneIssue(input: unknown, path: string, pattern?: RegExp): void {
  const issues = issuesOf(input);
  expect(issues, JSON.stringify(issues)).toHaveLength(1);
  expect(issues[0]?.path).toBe(path);
  if (pattern) expect(issues[0]?.message).toMatch(pattern);
}

describe("parseBoard", () => {
  test.each(examples)("accepts example %s", (name) => {
    const result = parseBoard(loadExample(name));
    expect(result.ok, JSON.stringify(result.ok ? null : result.error)).toBe(true);
  });

  test("accepts the minimal base board and fills defaults", () => {
    const input = base();
    delete input.edges;
    const result = parseBoard(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.edges).toEqual([]);
  });

  test("accepts tags in any language and keeps them", () => {
    const b = base();
    b.tags = ["service-admin", "受給権者", "người tham gia"];
    const result = parseBoard(b);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.tags).toEqual(["service-admin", "受給権者", "người tham gia"]);
  });

  test.each([
    [[""], "tags[0]"],
    [[" admin"], "tags[0]"],
    [["a\nb"], "tags[0]"],
    [["x".repeat(LIMITS.tag + 1)], "tags[0]"],
    [["admin", "admin"], "tags"],
    [Array.from({ length: LIMITS.tags + 1 }, (_, i) => `t${i}`), "tags"],
  ])("rejects tags %j", (tags, path) => {
    const b = base();
    b.tags = tags;
    expectOneIssue(b, path);
  });

  test("rejects a dangling edge", () => {
    const b = base();
    b.edges[0].to = "nope";
    expectOneIssue(b, "edges[0].to", /not a node id/);
  });

  test("rejects a duplicate id", () => {
    const b = base();
    b.nodes.push({ id: "n1", kind: "note", label: "dup" });
    expectOneIssue(b, "nodes[2].id", /duplicate node id `n1`/);
  });

  test("rejects an ungrounded cause", () => {
    const b = base();
    b.nodes.push({ id: "n3", kind: "cause", label: "why" });
    expectOneIssue(b, "nodes[2].sourceIds", /kind `cause`\) has no sourceIds/);
  });

  test("rejects a grounded source without quote", () => {
    const b = base();
    delete b.sources[0].quote;
    expectOneIssue(b, "sources[0].quote", /has no quote/);
  });

  test("allows a question or note to cite a source without quote", () => {
    const b = base();
    b.sources.push({ id: "s2", path: "README.md", line: 3 });
    b.nodes[1].sourceIds = ["s2"];
    expect(issuesOf(b)).toEqual([]);
  });

  test("rejects a group parentId cycle with one issue", () => {
    const b = base();
    b.groups = [
      { id: "g1", label: "A", parentId: "g2" },
      { id: "g2", label: "B", parentId: "g1" },
    ];
    expectOneIssue(b, "groups[0].parentId", /cycle/);
  });

  test("rejects nesting deeper than 4 levels", () => {
    const b = base();
    b.groups = [
      { id: "g1", label: "1" },
      { id: "g2", label: "2", parentId: "g1" },
      { id: "g3", label: "3", parentId: "g2" },
      { id: "g4", label: "4", parentId: "g3" },
      { id: "g5", label: "5", parentId: "g4" },
    ];
    expectOneIssue(b, "groups[4].parentId", /5 levels deep/);
    b.groups.pop();
    expect(issuesOf(b)).toEqual([]);
  });

  test.each([
    ["/etc/passwd", /not absolute/],
    ["C:/x.ts", /not absolute/],
    ["src/../../secret", /'\.\.' segment/],
    ["..", /'\.\.' segment/],
  ])("rejects source path %s", (p, pattern) => {
    const b = base();
    b.sources[0].path = p;
    expectOneIssue(b, "sources[0].path", pattern);
  });

  test.each([
    ["https://user:token@github.com/a/b", /user name, password or token/],
    ["https://token@github.com/a/b", /user name, password or token/],
    ["http://github.com/a/b", /https:/],
    ["git@github.com:a/b.git", /https: URL/],
    ["https://github.com/a/b#readme", /without a query or fragment/],
    ["https://github.com/a/b?tab=1", /without a query or fragment/],
  ])("rejects repo.url %s", (url, pattern) => {
    const b = base();
    b.repo = { url };
    expectOneIssue(b, "repo.url", pattern);
  });

  test("rejects a repo.commit that is not 7 to 40 hex characters", () => {
    const b = base();
    b.repo = { commit: "abc" };
    expectOneIssue(b, "repo.commit", /7 to 40 hexadecimal/);
  });

  test("rejects an oversize label", () => {
    const b = base();
    b.nodes[0].label = "x".repeat(LIMITS.longText + 1);
    expectOneIssue(b, "nodes[0].label", /longer than 2000 characters/);
  });

  test("rejects an unknown schemaVersion", () => {
    const b = base();
    b.schemaVersion = 2;
    expectOneIssue(b, "schemaVersion", /unsupported schemaVersion 2/);
  });

  test("rejects too many nodes", () => {
    const b = base();
    b.nodes = Array.from({ length: LIMITS.nodes + 1 }, (_, i) => ({
      id: `n${i}`,
      kind: "note",
      label: "x",
    }));
    b.edges = [];
    expectOneIssue(b, "nodes", /more than 500 items/);
  });

  test("rejects an unknown node kind with the allowed kinds", () => {
    const b = base();
    b.nodes[1].kind = "idea";
    expectOneIssue(b, "nodes[1].kind", /must be one of: "step"/);
  });

  test("rejects endLine before line", () => {
    const b = base();
    b.sources[0].line = 5;
    b.sources[0].endLine = 4;
    expectOneIssue(b, "sources[0].endLine", /before line 5/);
  });

  test("rejects non-object input", () => {
    expectOneIssue([], "", /JSON object/);
  });
});

// biome-ignore lint/suspicious/noExplicitAny: test boards are mutated freely to build bad inputs
function screenBoard(): Record<string, any> {
  return {
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
        id: "form",
        kind: "element",
        role: "container",
        label: "Payment form",
        parentId: "checkout",
        sourceIds: ["render"],
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
        id: "done",
        kind: "screen",
        label: "Done",
        ref: "web:done",
        platform: "web",
        layoutFrom: "code",
        sourceIds: ["route"],
      },
    ],
    edges: [
      { id: "e1", from: "pay", to: "done", kind: "navigates", sourceIds: ["nav"] },
      { id: "e2", from: "checkout", toRef: "web:cart", kind: "navigates", sourceIds: ["nav"] },
    ],
    sources: [
      { id: "route", path: "src/routes.tsx", line: 3, quote: '<Route path="/checkout"' },
      { id: "render", path: "src/Checkout.tsx", line: 10 },
      { id: "handler", kind: "code", path: "src/Checkout.tsx", line: 20, quote: "onPay()" },
      { id: "nav", path: "src/Checkout.tsx", line: 22, quote: 'navigate("/done")' },
    ],
  };
}

describe("screens and elements", () => {
  test("accepts a screen board with nested elements and both kinds of navigates edge", () => {
    expect(issuesOf(screenBoard())).toEqual([]);
  });

  test("defaults a source without kind to a code source", () => {
    const result = parseBoard(screenBoard());
    expect(result.ok && result.value.sources[1]?.kind).toBe("code");
  });

  test("accepts a figma source and rejects a malformed one", () => {
    const b = screenBoard();
    b.sources.push({ id: "fig", kind: "figma", fileKey: "AbCdEf0123456789", nodeId: "12:34" });
    b.nodes[0].sourceIds.push("fig");
    expect(issuesOf(b)).toEqual([]);
    b.sources[4].nodeId = "12-34";
    expectOneIssue(b, "sources[4].nodeId", /12:34/);
  });

  test("rejects an unknown source kind with the allowed kinds", () => {
    const b = screenBoard();
    b.sources[0].kind = "image";
    expectOneIssue(b, "sources[0].kind", /must be one of: "code", "figma"/);
  });

  // Rule 1: parent is a screen or element; no cycle; bounded depth.
  test("rejects an element whose parent is not a screen or element", () => {
    const b = screenBoard();
    b.nodes.push({ id: "n", kind: "note", label: "note" });
    b.nodes[1].parentId = "n";
    expectOneIssue(b, "nodes[1].parentId", /not a screen or element node/);
  });

  test("rejects an element parentId cycle with one issue", () => {
    const b = screenBoard();
    b.nodes[1].parentId = "pay";
    const issues = issuesOf(b).filter((i) => /cycle/.test(i.message));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/^element parentId chain forms a cycle/);
  });

  test("rejects elements nested deeper than 8 levels", () => {
    const b = screenBoard();
    b.nodes = b.nodes.filter((n: { kind: string }) => n.kind === "screen");
    b.edges = [];
    let parent = "checkout";
    for (let level = 1; level <= 9; level++) {
      b.nodes.push({
        id: `l${level}`,
        kind: "element",
        role: "container",
        label: "x",
        parentId: parent,
        sourceIds: ["render"],
      });
      parent = `l${level}`;
    }
    expectOneIssue(b, "nodes[10].parentId", /9 levels deep; at most 8/);
    b.nodes.pop();
    expect(issuesOf(b)).toEqual([]);
  });

  // Rule 2: the element ref extends its screen ref.
  test("rejects an element ref under another screen", () => {
    const b = screenBoard();
    b.nodes[2].ref = "web:cart/pay-button";
    expectOneIssue(b, "nodes[2].ref", /must start with `web:checkout\/`/);
  });

  // Rule 3: no groupId on an element, or on a screen drawn as a frame.
  test("rejects a groupId on a screen with elements", () => {
    const b = screenBoard();
    b.groups = [{ id: "g", label: "G" }];
    b.nodes[0].groupId = "g";
    expectOneIssue(b, "nodes[0].groupId", /must not have a groupId: it has elements or states/);
  });

  test("rejects a groupId on an element", () => {
    const b = screenBoard();
    b.groups = [{ id: "g", label: "G" }];
    b.nodes[2].groupId = "g";
    expectOneIssue(b, "nodes[2].groupId", /element node `pay` must not have a groupId/);
  });

  test("accepts a groupId on a screen with neither elements nor states", () => {
    const b = screenBoard();
    b.groups = [{ id: "g", label: "G" }];
    b.nodes[3].groupId = "g";
    expect(issuesOf(b)).toEqual([]);
  });

  test("rejects a groupId on a screen with states, and on its states", () => {
    const b = screenBoard();
    b.groups = [{ id: "g", label: "G" }];
    b.nodes.push({
      id: "done-error",
      kind: "screen",
      label: "Order failed",
      stateOf: "done",
      sourceIds: ["route"],
    });
    b.nodes[3].groupId = "g";
    expectOneIssue(b, "nodes[3].groupId", /must not have a groupId/);
    b.nodes[3].groupId = undefined;
    b.nodes[4].groupId = "g";
    expectOneIssue(b, "nodes[4].groupId", /must not have a groupId/);
  });

  // Rule 4: interactive elements cite a handler or are unresolved.
  test("rejects a button without action or unresolved, and accepts unresolved", () => {
    const b = screenBoard();
    delete b.nodes[2].action;
    expectOneIssue(b, "nodes[2].action", /needs an action backed by a quoted code source/);
    b.nodes[2].unresolved = "No handler found (Frontend)";
    b.nodes[2].sourceIds = [];
    expect(issuesOf(b)).toEqual([]);
  });

  test("rejects a button whose action cites no quoted code", () => {
    const b = screenBoard();
    b.nodes[2].sourceIds = ["render"];
    expectOneIssue(b, "nodes[2].sourceIds", /cites no source that can back it/);
  });

  test("treats the start of a navigates edge as interactive", () => {
    const b = screenBoard();
    b.nodes[1].role = "text";
    b.edges[0].from = "form";
    expectOneIssue(b, "nodes[1].action", /interactive element `form`/);
  });

  // Rule 5: non-interactive elements cite a source unless the layout comes from a design.
  test("rejects an uncited element on a code-derived screen, accepts it from a screenshot", () => {
    const b = screenBoard();
    b.nodes[1].sourceIds = [];
    expectOneIssue(b, "nodes[1].sourceIds", /cites no source/);
    b.nodes[0].layoutFrom = "screenshot";
    expect(issuesOf(b)).toEqual([]);
  });

  // Rule 6: navigates endpoints and grounding.
  test("rejects a navigates edge to a non-screen node", () => {
    const b = screenBoard();
    b.edges[0].to = "form";
    expectOneIssue(b, "edges[0].to", /must end at a screen/);
  });

  test("rejects a navigates edge from a note", () => {
    const b = screenBoard();
    b.nodes.push({ id: "n", kind: "note", label: "note" });
    b.edges[0].from = "n";
    expectOneIssue(b, "edges[0].from", /must start at a screen or element/);
  });

  test("rejects a navigates edge without a quoted code source", () => {
    const b = screenBoard();
    b.edges[1].sourceIds = [];
    expectOneIssue(b, "edges[1].sourceIds", /cites no source that can back a navigation/);
  });

  test("rejects an edge with both or neither of to and toRef", () => {
    const b = screenBoard();
    b.edges[1].to = "done";
    expectOneIssue(b, "edges[1].to", /both `to` and `toRef`/);
    delete b.edges[1].to;
    delete b.edges[1].toRef;
    expectOneIssue(b, "edges[1].to", /needs `to`/);
  });

  test("rejects toRef on a non-navigates edge and an element toRef", () => {
    const b = screenBoard();
    b.edges[1].kind = "relates";
    expectOneIssue(b, "edges[1].toRef", /only allowed on navigates/);
    b.edges[1].kind = "navigates";
    b.edges[1].toRef = "web:cart/total";
    expectOneIssue(b, "edges[1].toRef", /names an element/);
  });

  // Rule 7: edge sourceIds exist.
  test("rejects an edge citing a missing source", () => {
    const b = screenBoard();
    b.edges[0].sourceIds.push("ghost");
    expectOneIssue(b, "edges[0].sourceIds[1]", /not a source id/);
  });

  // Rule 8: a ref is defined once per board; other kinds refer to it.
  test("rejects a ref defined twice, and allows a note to refer to it", () => {
    const b = screenBoard();
    b.nodes[1].ref = "web:checkout/pay-button";
    expectOneIssue(b, "nodes[2].ref", /defined more than once/);
    delete b.nodes[1].ref;
    b.nodes.push({ id: "n", kind: "note", label: "see pay", ref: "web:checkout/pay-button" });
    expect(issuesOf(b)).toEqual([]);
  });

  // Rule 9: fields on the wrong kind.
  test.each([
    ["role", "button"],
    ["parentId", "checkout"],
    ["action", "x"],
    ["unresolved", "x"],
    ["layoutFrom", "code"],
    ["platform", "web"],
    ["direction", "row"],
  ])("rejects %s on a note", (field, value) => {
    const b = screenBoard();
    b.nodes.push({ id: "n", kind: "note", label: "note", [field]: value });
    expectOneIssue(b, `nodes[4].${field}`, /only allowed on/);
  });

  test("rejects a screen without ref, platform or layoutFrom", () => {
    for (const field of ["ref", "platform", "layoutFrom"]) {
      const b = screenBoard();
      delete b.nodes[3][field];
      if (field === "ref") b.edges = [b.edges[1]];
      expectOneIssue(b, `nodes[3].${field}`, /needs/);
    }
  });

  test("rejects a platform that disagrees with the ref", () => {
    const b = screenBoard();
    b.nodes[3].platform = "mobile";
    expectOneIssue(b, "nodes[3].platform", /ref `web:done`/);
  });

  test.each([
    "web:Cart",
    "desktop:cart",
    "web:cart/",
    "web:cart//x",
    "web:a--b",
    `web:${"a".repeat(61)}`,
  ])("rejects malformed ref %s", (ref) => {
    const b = screenBoard();
    b.nodes[3].ref = ref;
    b.edges = [b.edges[1]];
    expect(issuesOf(b).some((i) => i.path === "nodes[3].ref")).toBe(true);
  });

  // Rule 10: only code sources need a quote on grounded kinds.
  test("lets a screen drawn from Figma cite only a figma source", () => {
    const b = screenBoard();
    b.sources.push({ id: "fig", kind: "figma", fileKey: "AbCdEf0123456789", nodeId: "1:2" });
    b.nodes[3].sourceIds = ["fig"];
    b.nodes[3].layoutFrom = "figma";
    expect(issuesOf(b)).toEqual([]);
  });
});

const FIG = { id: "fig", kind: "figma", fileKey: "AbCdEf0123456789", nodeId: "1:2" };
const DOC = { id: "req", kind: "doc", path: "docs/requirements.md", line: 4, quote: "Pay submits" };
const LINK = { id: "lnk", kind: "link", url: "https://docs.example.com/spec", title: "Spec" };
const MOCKUP = { id: "mock", kind: "mockup", label: "Checkout mockup" };

describe("shared layouts", () => {
  /** The checkout screen drawn in `web:layout`, with the layout's Log out button. */
  // biome-ignore lint/suspicious/noExplicitAny: test boards are mutated freely to build bad inputs
  function inLayout(layouts: unknown = ["web:layout"]): Record<string, any> {
    const b = screenBoard();
    b.nodes[0].layouts = layouts;
    b.nodes.push({
      id: "logout",
      kind: "element",
      role: "button",
      label: "Log out",
      parentId: "form",
      ref: "web:layout/header-logout",
      action: "logs out",
      sourceIds: ["handler"],
    });
    return b;
  }

  test("an element may carry a ref of a layout its screen lists", () => {
    expect(issuesOf(inLayout())).toEqual([]);
  });

  test("the same layout element may appear twice on a board; a screen's own may not", () => {
    const b = inLayout();
    b.nodes.push({ ...b.nodes.at(-1), id: "logout-2" });
    expect(issuesOf(b)).toEqual([]);
    b.nodes.push({ ...b.nodes[2], id: "pay-2" });
    expectOneIssue(b, "nodes[6].ref", /defined more than once/);
  });

  test("without layouts, a ref of another screen is refused and the fix is named", () => {
    const b = inLayout();
    delete b.nodes[0].layouts;
    expectOneIssue(b, "nodes[4].ref", /must start with `web:checkout\/`.*`layouts`/);
  });

  test("a ref of a screen not in layouts is refused", () => {
    const b = inLayout();
    b.nodes.at(-1).ref = "web:footer/privacy";
    expectOneIssue(b, "nodes[4].ref", /`web:checkout\/` or `web:layout\/`/);
  });

  test.each([
    [["web:layout/header"], /a layout is a screen ref/],
    [["mobile:layout"], /web screen but lists the mobile layout/],
    [["web:checkout"], /its own ref/],
    [["web:layout", "web:layout"], /twice/],
  ])("layouts %j is refused", (layouts, pattern) => {
    const issues = issuesOf(inLayout(layouts));
    expect(
      issues.some((i) => i.path.startsWith("nodes[0].layouts") && pattern.test(i.message)),
    ).toBe(true);
  });

  test("layout and layouts belong to a screen, and not to a state", () => {
    const b = inLayout();
    b.nodes[1].layout = true;
    expectOneIssue(b, "nodes[1].layout");
    const s = screenBoard();
    s.nodes.push({
      id: "busy",
      kind: "screen",
      label: "Busy",
      stateOf: "checkout",
      layouts: ["web:layout"],
      sourceIds: ["route"],
    });
    expect(issuesOf(s).map((i) => i.path)).toContain(`nodes[${s.nodes.length - 1}].layouts`);
  });
});

describe("widths", () => {
  /** The screen board with the checkout screen's children side by side. */
  function rowBoard() {
    const b = screenBoard();
    b.nodes[0].direction = "row";
    return b;
  }

  test("accepts a fixed-width element in a row and a wider screen", () => {
    const b = rowBoard();
    b.nodes[0].width = 1280;
    b.nodes[1].width = 225;
    expect(issuesOf(b)).toEqual([]);
  });

  test("rejects width on a node that is not a screen or element", () => {
    const b = base();
    b.nodes[1].width = 100;
    expectOneIssue(b, "nodes[1].width", /only allowed on `screen` and `element` nodes/);
  });

  test("rejects width on an element whose parent is not a row", () => {
    const b = screenBoard();
    b.nodes[1].width = 225;
    expectOneIssue(b, "nodes[1].width", /parent `checkout` stacks children in a column/);
  });

  test.each([0, -5, 1.5, 4001])("rejects element width %s", (width) => {
    const b = rowBoard();
    b.nodes[1].width = width;
    const issues = issuesOf(b);
    expect(issues.length, JSON.stringify(issues)).toBeGreaterThan(0);
    expect(issues.map((i) => i.path)).toContain("nodes[1].width");
  });

  test("rejects a screen width outside the platform's bounds", () => {
    const b = screenBoard();
    b.nodes[0].width = 1921;
    expectOneIssue(b, "nodes[0].width", /a web screen is 320 to 1920 pixels wide/);
    const m = screenBoard();
    Object.assign(m.nodes[0], { platform: "mobile", ref: "mobile:checkout", width: 700 });
    m.nodes[2].ref = "mobile:checkout/pay-button";
    expectOneIssue(m, "nodes[0].width", /a mobile screen is 280 to 600 pixels wide/);
  });

  test("rejects width on a screen without elements", () => {
    const b = screenBoard();
    b.nodes[3].width = 1280;
    expectOneIssue(b, "nodes[3].width", /has width but no elements/);
  });

  test("rejects fixed widths that overflow a row, on the row, with the numbers", () => {
    const b = rowBoard();
    b.nodes[0].width = 400; // inner 376
    b.nodes[1].width = 377;
    expectOneIssue(
      b,
      "nodes[0]",
      /row `checkout` needs 377 pixels \(fixed widths 377, gaps 0\) but has 376/,
    );
  });

  test("keeps room for each flexible child of an overflowing row", () => {
    const b = rowBoard();
    b.nodes[0].width = 400; // inner 376
    b.nodes[1].width = 360;
    b.nodes.push({
      id: "aside",
      kind: "element",
      role: "text",
      label: "Aside",
      parentId: "checkout",
      sourceIds: ["render"],
    });
    // 360 + 8 gap + 8 for the flexible child = 376 fits; one more pixel does not.
    expect(issuesOf(b)).toEqual([]);
    b.nodes[1].width = 361;
    expectOneIssue(
      b,
      "nodes[0]",
      /needs 377 pixels \(fixed widths 361, gaps 8, 1 flexible × 8\) but has 376/,
    );
  });

  test("checks a nested row against the width its parent gives it", () => {
    const b = screenBoard();
    b.nodes[1].direction = "row"; // form: 936 wide, inner 912
    b.nodes[2].width = 913;
    expectOneIssue(
      b,
      "nodes[1]",
      /row `form` needs 913 pixels \(fixed widths 913, gaps 0\) but has 912/,
    );
    b.nodes[2].width = 912;
    expect(issuesOf(b)).toEqual([]);
  });
});

describe("specification sources", () => {
  test.each([
    ["doc", DOC],
    ["doc with endLine", { ...DOC, endLine: 6 }],
    ["link", LINK],
    ["link with quote and date", { ...LINK, quote: "Pay goes to done", retrievedAt: "2026-11-19" }],
    ["link with a harmless query", { ...LINK, url: "https://docs.example.com/spec?node=12#top" }],
    ["mockup", MOCKUP],
    ["mockup with path", { ...MOCKUP, path: "design/checkout.png" }],
  ])("accepts a %s source", (_, source) => {
    const b = screenBoard();
    b.sources.push(source);
    b.nodes[0].sourceIds.push(source.id);
    expect(issuesOf(b)).toEqual([]);
  });

  test.each([
    ["doc without quote", { ...DOC, quote: undefined }, "sources[4].quote"],
    ["doc with an empty quote", { ...DOC, quote: "" }, "sources[4].quote"],
    ["doc without line", { ...DOC, line: undefined }, "sources[4].line"],
    ["doc with an absolute path", { ...DOC, path: "/etc/passwd" }, "sources[4].path"],
    ["link without title", { ...LINK, title: undefined }, "sources[4].title"],
    ["link without url", { ...LINK, url: undefined }, "sources[4].url"],
    ["link with a bad date", { ...LINK, retrievedAt: "yesterday" }, "sources[4].retrievedAt"],
    ["mockup without label", { ...MOCKUP, label: undefined }, "sources[4].label"],
    ["mockup with a .. path", { ...MOCKUP, path: "../x.png" }, "sources[4].path"],
  ])("rejects a %s", (_, source, path) => {
    const b = screenBoard();
    b.sources.push(JSON.parse(JSON.stringify(source)));
    b.nodes[0].sourceIds.push(source.id);
    expectOneIssue(b, path);
  });

  test("rejects a doc whose endLine is before its line", () => {
    const b = screenBoard();
    b.sources.push({ ...DOC, line: 5, endLine: 2 });
    expectOneIssue(b, "sources[4].endLine", /before line 5/);
  });

  test.each([
    ["http://docs.example.com/spec", /must use https:/],
    ["https://user:pw@docs.example.com/spec", /user name, password or token/],
    ["https://docs.example.com/spec?token=abc123", /`token` that looks like a credential/],
    ["https://bucket.s3.amazonaws.com/a.pdf?X-Amz-Signature=deadbeef", /`X-Amz-Signature`/],
    ["https://storage.googleapis.com/a?X-Goog-Credential=x", /`X-Goog-Credential`/],
    ["https://docs.example.com/spec?Sig=1", /`Sig`/],
    ["https://docs.example.com/spec?api_key=1", /`api_key`/],
    ["javascript:alert(1)", /must use https:/],
    ["not a url", /absolute https: URL/],
  ])("rejects link url %s", (url, pattern) => {
    const b = screenBoard();
    b.sources.push({ ...LINK, url });
    b.nodes[0].sourceIds.push("lnk");
    expectOneIssue(b, "sources[4].url", pattern);
  });

  test("does not repeat a secret parameter's value in the message", () => {
    const b = screenBoard();
    b.sources.push({ ...LINK, url: "https://docs.example.com/spec?token=s3cr3t-value" });
    const issues = issuesOf(b);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).not.toContain("s3cr3t-value");
  });

  test.each([
    ["figma", FIG],
    ["doc", DOC],
    ["mockup with path", { ...MOCKUP, path: "design/checkout.png" }],
    ["link with quote", { ...LINK, quote: "Pay submits the order" }],
  ])("lets an action and a navigates edge rest on a %s source", (_, source) => {
    const b = screenBoard();
    b.sources.push(source);
    b.nodes[2].sourceIds = [source.id];
    b.edges[0].sourceIds = [source.id];
    b.edges[1].sourceIds = [source.id];
    expect(issuesOf(b)).toEqual([]);
  });

  test.each([
    ["mockup without path", MOCKUP],
    ["link without quote", LINK],
  ])("refuses an action resting only on a %s", (_, source) => {
    const b = screenBoard();
    b.sources.push(source);
    b.nodes[2].sourceIds = [source.id];
    expectOneIssue(b, "nodes[2].sourceIds", /cites no source that can back it/);
  });

  test.each([
    ["mockup without path", MOCKUP],
    ["link without quote", LINK],
  ])("refuses a navigates edge resting only on a %s", (_, source) => {
    const b = screenBoard();
    b.sources.push(source);
    b.edges[1].sourceIds = [source.id];
    expectOneIssue(b, "edges[1].sourceIds", /cites no source that can back a navigation/);
  });

  test("refuses layoutFrom code on a screen that cites no code source", () => {
    const b = screenBoard();
    b.sources.push(DOC);
    b.nodes[3].sourceIds = ["req"];
    expectOneIssue(b, "nodes[3].layoutFrom", /cites no code source/);
    b.nodes[3].layoutFrom = "doc";
    expect(issuesOf(b)).toEqual([]);
  });

  test("refuses elements under a screen described only in a document", () => {
    const b = screenBoard();
    b.nodes[0].layoutFrom = "doc";
    const issues = issuesOf(b);
    expect(issues.map((i) => i.path)).toEqual(["nodes[1].parentId", "nodes[2].parentId"]);
    expect(issues[0]?.message).toMatch(/layoutFrom is doc/);
  });

  test("lets elements of a mockup-drawn screen cite nothing", () => {
    const b = screenBoard();
    b.nodes[1].sourceIds = [];
    b.nodes[0].layoutFrom = "mockup";
    expect(issuesOf(b)).toEqual([]);
  });

  test("lists every layout origin when layoutFrom is missing", () => {
    const b = screenBoard();
    delete b.nodes[3].layoutFrom;
    expectOneIssue(b, "nodes[3].layoutFrom", /figma, screenshot, mockup, doc, code/);
  });

  test("rejects an unknown source kind with every allowed kind", () => {
    const b = screenBoard();
    b.sources[0].kind = "ticket";
    expectOneIssue(b, "sources[0].kind", /"code", "figma", "doc", "link", "mockup"/);
  });
});

describe("board.schema.json", () => {
  test("matches the generated JSON Schema (run `pnpm --filter @groundboard/schema emit`)", () => {
    const committed = readFileSync(
      path.join(import.meta.dirname, "..", "board.schema.json"),
      "utf8",
    );
    expect(committed).toBe(boardJsonSchemaText());
  });
});
