import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { atlasHasProblems, buildAtlas, MAX_ATLAS_BOARDS, MAX_SPEC_ONLY_PATHS } from "./atlas.ts";

let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "atlas-"));
  dir = path.join(root, ".groundboard");
  mkdirSync(dir);
  mkdirSync(path.join(root, "src"));
  writeFileSync(
    path.join(root, "src", "routes.tsx"),
    [
      '<Route path="/cart" element={<Cart />} />',
      '<Route path="/checkout" element={<Checkout />} />',
      'navigate("/checkout");',
      'navigate("/cart");',
      "function onPay() {}",
    ].join("\n"),
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const src = {
  cart: { id: "r-cart", path: "src/routes.tsx", line: 1, quote: 'path="/cart"' },
  checkout: { id: "r-checkout", path: "src/routes.tsx", line: 2, quote: 'path="/checkout"' },
  toCheckout: {
    id: "nav-checkout",
    path: "src/routes.tsx",
    line: 3,
    quote: 'navigate("/checkout")',
  },
  toCart: { id: "nav-cart", path: "src/routes.tsx", line: 4, quote: 'navigate("/cart")' },
  pay: { id: "pay", path: "src/routes.tsx", line: 5, quote: "onPay" },
};

const screen = (id: string, ref: string, sourceId: string) => ({
  id,
  kind: "screen",
  label: id,
  ref,
  platform: ref.split(":")[0],
  layoutFrom: "code",
  sourceIds: [sourceId],
});

function overview(platform: "web" | "mobile" = "web") {
  return {
    schemaVersion: 1,
    title: `Overview ${platform}`,
    question: "Which screens are there?",
    nodes: [
      screen("cart", `${platform}:cart`, "r-cart"),
      screen("checkout", `${platform}:checkout`, "r-checkout"),
    ],
    edges: [
      { id: "go", from: "cart", to: "checkout", kind: "navigates", sourceIds: ["nav-checkout"] },
    ],
    sources: [src.cart, src.checkout, src.toCheckout],
  };
}

function checkoutScreen() {
  return {
    schemaVersion: 1,
    title: "Checkout",
    question: "What is on checkout?",
    nodes: [
      { ...screen("checkout", "web:checkout", "r-checkout"), layoutFrom: "screenshot" },
      {
        id: "pay",
        kind: "element",
        role: "button",
        label: "Pay",
        parentId: "checkout",
        ref: "web:checkout/pay-button",
        action: "pays",
        sourceIds: ["pay"],
      },
      {
        id: "back",
        kind: "element",
        role: "link",
        label: "Back",
        parentId: "checkout",
        action: "back",
        sourceIds: ["nav-cart"],
      },
    ],
    edges: [
      {
        id: "to-cart",
        from: "back",
        toRef: "web:cart",
        kind: "navigates",
        sourceIds: ["nav-cart"],
      },
    ],
    sources: [src.checkout, src.pay, src.toCart],
  };
}

function flow() {
  return {
    schemaVersion: 1,
    title: "Place order",
    question: "How is an order placed?",
    nodes: [
      {
        id: "click",
        kind: "step",
        label: "Customer pays",
        ref: "web:checkout/pay-button",
        sourceIds: ["pay"],
      },
    ],
    sources: [src.pay],
  };
}

const write = (name: string, board: unknown) =>
  writeFileSync(path.join(dir, name), typeof board === "string" ? board : JSON.stringify(board));

describe("buildAtlas", () => {
  test("indexes a clean atlas: kinds, refs defined and used, no problems", async () => {
    write("overview-web.board.json", overview());
    write("web--checkout.board.json", checkoutScreen());
    write("place-order.board.json", flow());
    const atlas = await buildAtlas(dir, root);
    expect(atlas.problems).toEqual([]);
    expect(atlasHasProblems(atlas)).toBe(false);
    expect(atlas.boards.map((b) => [b.slug, b.kind, b.status])).toEqual([
      ["overview-web", "overview", "ok"],
      ["place-order", "flow", "ok"],
      ["web--checkout", "screen", "ok"],
    ]);
    expect(atlas.boards[2]?.layoutFrom).toEqual(["screenshot"]);
    const pay = atlas.refs.find((r) => r.ref === "web:checkout/pay-button");
    expect(pay).toEqual({
      ref: "web:checkout/pay-button",
      // The definition names the control as a reader sees it; a flow step that points at it
      // carries neither.
      definedIn: [
        { slug: "web--checkout", nodeId: "pay", kind: "element", label: "Pay", role: "button" },
      ],
      usedIn: [{ slug: "place-order", nodeId: "click" }],
    });
    // A screen defined on the overview and on its own board is not a duplicate.
    expect(atlas.refs.find((r) => r.ref === "web:checkout")?.definedIn).toHaveLength(2);
    // Two screen boards pointing at each other with toRef are fine.
    expect(atlas.refs.find((r) => r.ref === "web:cart")?.usedIn).toEqual([
      { slug: "web--checkout", nodeId: "back", edgeId: "to-cart" },
    ]);
  });

  test("reports a dangling ref", async () => {
    write("place-order.board.json", flow());
    const atlas = await buildAtlas(dir, root);
    expect(atlas.problems).toEqual([
      {
        path: "web:checkout/pay-button",
        message:
          "ref `web:checkout/pay-button` is used in place-order (click) but no board defines it",
      },
    ]);
    expect(atlasHasProblems(atlas)).toBe(true);
  });

  test("reports an element defined twice and a screen on two overviews", async () => {
    write("web--checkout.board.json", checkoutScreen());
    write("web--checkout-copy.board.json", checkoutScreen());
    write("overview-a.board.json", overview());
    write("overview-b.board.json", overview());
    const atlas = await buildAtlas(dir, root);
    const refs = atlas.problems.map((p) => p.path);
    expect(refs).toContain("web:checkout/pay-button");
    expect(refs).toContain("web:cart");
    expect(refs).toContain("web:checkout");
  });

  test("web and mobile overviews may share screen slugs", async () => {
    write("overview-web.board.json", overview("web"));
    write("overview-mobile.board.json", overview("mobile"));
    const atlas = await buildAtlas(dir, root);
    expect(atlas.problems).toEqual([]);
    expect(atlas.refs.map((r) => r.ref)).toEqual([
      "mobile:cart",
      "mobile:checkout",
      "web:cart",
      "web:checkout",
    ]);
  });

  test("sees a board go stale on the next call after a source file changes", async () => {
    write("overview-web.board.json", overview());
    expect((await buildAtlas(dir, root)).boards[0]?.status).toBe("ok");
    writeFileSync(path.join(root, "src", "routes.tsx"), "// rewritten\n");
    const atlas = await buildAtlas(dir, root);
    expect(atlas.boards[0]?.status).toBe("stale");
    expect(atlas.boards[0]?.issues.length).toBeGreaterThan(0);
    expect(atlasHasProblems(atlas)).toBe(true);
  });

  test("marks an unparsable or invalid board invalid and keeps going", async () => {
    write("broken.board.json", "{ not json");
    write("bad.board.json", { ...overview(), schemaVersion: 2 });
    write("overview-web.board.json", overview());
    const atlas = await buildAtlas(dir, root);
    expect(atlas.boards.map((b) => [b.slug, b.status])).toEqual([
      ["bad", "invalid"],
      ["broken", "invalid"],
      ["overview-web", "ok"],
    ]);
    expect(atlas.boards[0]?.issues[0]?.path).toBe("schemaVersion");
    // The parser's own message would quote the file; the index gives a fixed one.
    expect(atlas.boards[1]?.issues).toEqual([
      { path: "", message: "the board file is not valid JSON" },
    ]);
  });

  test("ignores files with bad names, symlinks, FIFOs and other files", async () => {
    write("overview-web.board.json", overview());
    write(".hidden.board.json", overview());
    write("notes.json", "{}");
    writeFileSync(path.join(root, "elsewhere.board.json"), JSON.stringify(flow()));
    symlinkSync(path.join(root, "elsewhere.board.json"), path.join(dir, "linked.board.json"));
    execFileSync("mkfifo", [path.join(dir, "pipe.board.json")]);
    const atlas = await buildAtlas(dir, root);
    expect(atlas.boards.map((b) => b.slug)).toEqual(["overview-web"]);
    expect(atlas.problems).toEqual([expect.objectContaining({ path: ".hidden.board.json" })]);
  });

  test("stops reading at the byte cap and says so", async () => {
    write("overview-web.board.json", overview());
    write("place-order.board.json", flow());
    const size = JSON.stringify(overview()).length;
    const atlas = await buildAtlas(dir, root, { maxBytes: size + 10 });
    expect(atlas.boards[0]?.status).not.toBe("ok");
    expect(atlas.boards[1]?.status).toBe("invalid");
    expect(atlas.boards[1]?.issues[0]?.message).toMatch(/exceeds the total size/);
  });

  test("reads at most the board limit and reports the rest", async () => {
    for (let i = 0; i <= MAX_ATLAS_BOARDS; i++)
      write(`b${String(i).padStart(3, "0")}.board.json`, flow());
    write("web--checkout.board.json", checkoutScreen());
    const atlas = await buildAtlas(dir, root);
    expect(atlas.boards).toHaveLength(MAX_ATLAS_BOARDS);
    expect(atlas.problems[0]?.message).toMatch(/only the first 200/);
  });
});

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const lifecycleSpec = path.join(repoRoot, "examples/fixtures/lifecycle/spec");

/** Overview of three screens: one from code, one from a document, one unresolved element. */
function mixedScreen() {
  writeFileSync(path.join(root, "src", "req.md"), "Help opens the help centre.\n");
  return {
    schemaVersion: 1,
    title: "Mixed",
    question: "What is on cart?",
    nodes: [
      { ...screen("cart", "web:cart", "r-cart"), layoutFrom: "screenshot" },
      {
        id: "pay",
        kind: "element",
        role: "button",
        label: "Pay",
        parentId: "cart",
        action: "pays",
        sourceIds: ["pay"],
      },
      {
        id: "help",
        kind: "element",
        role: "link",
        label: "Help",
        parentId: "cart",
        action: "opens help",
        sourceIds: ["req"],
      },
      {
        id: "chat",
        kind: "element",
        role: "button",
        label: "Chat",
        parentId: "cart",
        unresolved: "No handler (Frontend)",
      },
      { id: "why", kind: "question", label: "Who owns chat?" },
    ],
    edges: [{ id: "q", from: "why", to: "chat", kind: "relates" }],
    sources: [
      src.cart,
      src.pay,
      { id: "req", kind: "doc", path: "src/req.md", line: 1, quote: "Help opens the help centre." },
      { id: "fig", kind: "figma", fileKey: "AbCdEf0123456789", nodeId: "1:2" },
      { id: "lnk", kind: "link", url: "https://docs.example.com/a", title: "Spec" },
      { id: "m1", kind: "mockup", label: "Kept in Drive" },
      { id: "m2", kind: "mockup", label: "Committed", path: "src/routes.tsx" },
    ],
  };
}

describe("grounding coverage", () => {
  test("counts claims by grounding and lists the spec-only ones", async () => {
    write("web--cart.board.json", mixedScreen());
    const [entry] = (await buildAtlas(dir, root)).boards;
    expect(entry?.status).toBe("ok");
    expect(entry?.grounding).toEqual({ code: 2, spec: 1, none: 1 });
    expect(entry?.specOnly).toEqual(["nodes[2]"]);
    expect(entry?.specOnlyTruncated).toBe(false);
    // Figma, the link and the path-less mockup; not the doc nor the committed mockup.
    expect(entry?.uncheckedSources).toBe(3);
  });

  test("caps the spec-only list", async () => {
    const board = overview();
    board.sources.push({
      id: "req",
      kind: "doc",
      path: "src/routes.tsx",
      line: 1,
      quote: "Route",
    } as never);
    for (let i = 0; i < MAX_SPEC_ONLY_PATHS + 5; i++) {
      board.nodes.push({ ...screen(`s${i}`, `web:s${i}`, "req"), layoutFrom: "doc" });
    }
    write("overview-web.board.json", board);
    const [entry] = (await buildAtlas(dir, root)).boards;
    expect(entry?.specOnly).toHaveLength(MAX_SPEC_ONLY_PATHS);
    expect(entry?.specOnlyTruncated).toBe(true);
  });

  test("require code reports spec-only and unresolved claims; require spec only unresolved", async () => {
    write("web--cart.board.json", mixedScreen());
    expect((await buildAtlas(dir, root)).problems).toEqual([]);
    expect((await buildAtlas(dir, root, { require: "code" })).problems).toEqual([
      {
        path: "web--cart.board.json",
        message: "2 claim(s) are not backed by code (spec only or unresolved): nodes[2], nodes[3]",
      },
    ]);
    const spec = await buildAtlas(dir, root, { require: "spec" });
    expect(spec.problems).toEqual([
      {
        path: "web--cart.board.json",
        message: "1 claim(s) cite no specification or code (unresolved): nodes[3]",
      },
    ]);
    expect(atlasHasProblems(spec)).toBe(true);
  });

  test("lists at most ten claims in a require problem", async () => {
    const board = overview();
    board.sources.push({
      id: "req",
      kind: "doc",
      path: "src/routes.tsx",
      line: 1,
      quote: "Route",
    } as never);
    for (let i = 0; i < 12; i++)
      board.nodes.push({ ...screen(`s${i}`, `web:s${i}`, "req"), layoutFrom: "doc" });
    write("overview-web.board.json", board);
    const [problem] = (await buildAtlas(dir, root, { require: "code" })).problems;
    expect(problem?.message).toMatch(/^12 claim\(s\).*nodes\[11\], and 2 more$/);
  });

  test("the spec-stage fixture passes, fails require code, and fails require spec on its unresolved link", async () => {
    const atlasDir = path.join(lifecycleSpec, ".groundboard");
    const plain = await buildAtlas(atlasDir, lifecycleSpec);
    expect(atlasHasProblems(plain)).toBe(false);
    expect(plain.boards.every((b) => b.grounding.code === 0)).toBe(true);
    const code = await buildAtlas(atlasDir, lifecycleSpec, { require: "code" });
    expect(code.problems.map((p) => p.path)).toEqual([
      "overview-web.board.json",
      "web--signup.board.json",
    ]);
    const spec = await buildAtlas(atlasDir, lifecycleSpec, { require: "spec" });
    expect(spec.problems).toEqual([
      expect.objectContaining({
        path: "web--signup.board.json",
        message: expect.stringMatching(/nodes\[7\]$/),
      }),
    ]);
  });

  test("a question node never fails require, on the committed code-stage atlas", async () => {
    const fixtures = path.join(repoRoot, "examples/fixtures");
    const atlas = await buildAtlas(path.join(fixtures, ".groundboard"), fixtures, {
      require: "spec",
    });
    // Only the account screen fails: its delete button is unresolved and its export link was
    // added by hand. The flows' question nodes do not count.
    expect(atlas.problems).toEqual([
      expect.objectContaining({
        path: "web--account.board.json",
        message: expect.stringMatching(/nodes\[5\], nodes\[6\]$/),
      }),
    ]);
  });
});

describe("baseline", () => {
  let baseline: string;
  beforeEach(() => {
    baseline = path.join(root, ".groundboard-baseline");
    mkdirSync(baseline);
    write("overview-web.board.json", overview());
    write("web--checkout.board.json", checkoutScreen());
    writeFileSync(path.join(baseline, "overview-web.board.json"), JSON.stringify(overview()));
    writeFileSync(
      path.join(baseline, "web--checkout.board.json"),
      JSON.stringify(checkoutScreen()),
    );
  });

  test("passes when nothing was lost, and when ids were only added", async () => {
    expect((await buildAtlas(dir, root, { baselineDir: baseline })).problems).toEqual([]);
    const grown = checkoutScreen();
    grown.nodes.push({
      id: "extra",
      kind: "element",
      role: "text",
      label: "New",
      parentId: "checkout",
      sourceIds: ["pay"],
    } as never);
    write("web--checkout.board.json", grown);
    expect((await buildAtlas(dir, root, { baselineDir: baseline })).problems).toEqual([]);
  });

  test("names a lost node id, edge id and ref", async () => {
    const changed = checkoutScreen();
    changed.nodes[2] = { ...(changed.nodes[2] as object), id: "back-link" } as never;
    changed.edges[0] = {
      ...(changed.edges[0] as object),
      from: "back-link",
      id: "to-cart-2",
    } as never;
    (changed.nodes[1] as { ref?: string }).ref = "web:checkout/pay";
    write("web--checkout.board.json", changed);
    const atlas = await buildAtlas(dir, root, { baselineDir: baseline });
    expect(atlas.problems).toEqual([
      { path: "web--checkout.board.json", message: "node id(s) in the baseline are gone: `back`" },
      {
        path: "web--checkout.board.json",
        message: "edge id(s) in the baseline are gone: `to-cart`",
      },
      {
        path: "web--checkout.board.json",
        message: "ref(s) in the baseline are gone: `web:checkout/pay-button`",
      },
    ]);
  });

  test("reports a board that is gone", async () => {
    rmSync(path.join(dir, "web--checkout.board.json"));
    const atlas = await buildAtlas(dir, root, { baselineDir: baseline });
    expect(atlas.problems.map((p) => p.path)).toContain("baseline/web--checkout.board.json");
  });

  test("reports an unreadable baseline board", async () => {
    writeFileSync(path.join(baseline, "web--checkout.board.json"), "{ nope");
    const atlas = await buildAtlas(dir, root, { baselineDir: baseline });
    expect(atlas.problems).toEqual([
      {
        path: "baseline/web--checkout.board.json",
        message: "the baseline board cannot be read as a valid board",
      },
    ]);
  });
});

describe("missing flows", () => {
  const flowWarning = (warnings: string[] | undefined) =>
    (warnings ?? []).filter((w) => w.includes("have no flow yet"));
  const unlinkedWarning = (warnings: string[] | undefined) =>
    (warnings ?? []).filter((w) => w.includes("have no ref"));

  test("warns about elements that change state with no flow, without failing", async () => {
    const states = path.join(repoRoot, "examples/fixtures/states");
    const atlas = await buildAtlas(path.join(states, ".groundboard"), states);
    expect(atlasHasProblems(atlas)).toBe(false);
    expect(atlas.refs.find((r) => r.ref === "web:users-upload/choose-file")?.needsFlow).toBe(true);
    expect(flowWarning(atlas.warnings)).toEqual([
      "8 element(s) that call an API or change state have no flow yet: `web:users-upload/cancel-validation`, `web:users-upload/choose-file`, `web:users-upload/confirm-cancel`, `web:users-upload/dialog-cancel`, `web:users-upload/dialog-import`, and 3 more; draw one with the board skill, e.g. /groundboard:board",
    ]);
  });

  test("a flow step carrying the element's ref covers it", async () => {
    const fixtures = path.join(repoRoot, "examples/fixtures");
    const atlas = await buildAtlas(path.join(fixtures, ".groundboard"), fixtures, {
      require: "spec",
    });
    expect(atlas.refs.find((r) => r.ref === "web:checkout/pay-button")?.needsFlow).toBe(true);
    expect(flowWarning(atlas.warnings)).toEqual([]);
    expect(atlas.problems.map((p) => p.path)).toEqual(["web--account.board.json"]);
  });

  test("an element that calls an API with no flow is listed by its ref", async () => {
    const screenBoard = checkoutScreen();
    screenBoard.edges.push({
      id: "pay-call",
      from: "pay",
      toRef: "api:orders/create",
      kind: "calls",
      sourceIds: ["pay"],
    });
    write("web--checkout.board.json", screenBoard);
    const atlas = await buildAtlas(dir, root);
    expect(atlas.refs.find((r) => r.ref === "web:checkout/pay-button")?.needsFlow).toBe(true);
    expect(flowWarning(atlas.warnings)).toEqual([
      expect.stringContaining(
        "1 element(s) that call an API or change state have no flow yet: `web:checkout/pay-button`; draw",
      ),
    ]);
    // A flow drawn for it clears the warning.
    write("place-order.board.json", flow());
    expect(flowWarning((await buildAtlas(dir, root)).warnings)).toEqual([]);
  });

  test("an endpoint whose handler has logic is listed with its shape until a node carries its ref", async () => {
    const apiBoard = (handler?: object) => ({
      schemaVersion: 1,
      title: "Orders API",
      question: "Which endpoints?",
      nodes: [
        { id: "orders", kind: "resource", label: "Orders", ref: "api:orders" },
        {
          id: "post",
          kind: "endpoint",
          label: "Place an order",
          parentId: "orders",
          method: "POST",
          path: "/orders",
          ref: "api:orders/post",
          sourceIds: ["pay"],
          ...(handler ? { handler } : {}),
        },
      ],
      sources: [src.pay],
    });
    write("api--orders.board.json", apiBoard());
    const plain = await buildAtlas(dir, root);
    expect(flowWarning(plain.warnings)).toEqual([]);

    write("api--orders.board.json", apiBoard({ shape: "sequence", sourceIds: ["pay"] }));
    const atlas = await buildAtlas(dir, root);
    expect(atlasHasProblems(atlas)).toBe(false);
    expect(atlas.refs.find((r) => r.ref === "api:orders/post")).toMatchObject({
      needsFlow: true,
      flowShape: "sequence",
    });
    expect(flowWarning(atlas.warnings)).toEqual([
      "1 endpoint(s) whose handler has logic have no flow yet: `api:orders/post` (sequence); draw one with the board skill, its first node carrying the endpoint's ref, e.g. /groundboard:board",
    ]);

    // A flow whose first step carries the endpoint's ref explains it.
    write("place-order-handler.board.json", {
      schemaVersion: 1,
      title: "Placing an order",
      question: "What does POST /orders do?",
      nodes: [
        {
          id: "in",
          kind: "step",
          label: "Receives the order",
          ref: "api:orders/post",
          sourceIds: ["pay"],
        },
      ],
      sources: [src.pay],
    });
    expect(flowWarning((await buildAtlas(dir, root)).warnings)).toEqual([]);
  });

  test("a participant or a message that points at a ref no board defines is a problem", async () => {
    write("pay-sequence.board.json", {
      schemaVersion: 1,
      title: "Paying",
      question: "Who talks to whom?",
      nodes: [
        { id: "user", kind: "participant", category: "person", label: "Customer" },
        {
          id: "api",
          kind: "participant",
          category: "system",
          label: "Orders API",
          ref: "api:orders/post",
          sourceIds: ["pay"],
        },
      ],
      edges: [
        {
          id: "m1",
          kind: "message",
          from: "user",
          to: "api",
          label: "pay",
          ref: "db:payments",
          sourceIds: ["pay"],
        },
      ],
      sources: [src.pay],
    });
    const atlas = await buildAtlas(dir, root);
    expect(atlas.boards[0]?.status).toBe("ok");
    expect(atlas.problems.map((p) => p.message)).toEqual([
      "ref `api:orders/post` is used in pay-sequence (api) but no board defines it",
      "ref `db:payments` is used in pay-sequence (user) but no board defines it",
    ]);
  });

  test("warns about elements that change state without a ref, also only a warning", async () => {
    const figma = path.join(repoRoot, "examples/fixtures/figma");
    const atlas = await buildAtlas(path.join(figma, ".groundboard"), figma);
    expect(unlinkedWarning(atlas.warnings)).toEqual([
      "2 element(s) call an API or change state but have no ref, so no flow can point at them: web--users (delete), web--users (confirm-ok); give each a ref such as web:<screen>/<element>",
    ]);
    expect(atlas.problems.some((p) => p.message.includes("no ref"))).toBe(false);
  });

  test("lists five elements and counts the rest", async () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    const base = checkoutScreen();
    write("web--checkout.board.json", {
      ...base,
      nodes: [
        base.nodes[0],
        ...ids.map((id) => ({
          id,
          kind: "element",
          role: "button",
          label: id,
          parentId: "checkout",
          action: "calls",
          sourceIds: ["pay"],
        })),
      ],
      edges: ids.map((id) => ({
        id: `call-${id}`,
        from: id,
        toRef: "api:orders/create",
        kind: "calls",
        sourceIds: ["pay"],
      })),
    });
    const atlas = await buildAtlas(dir, root, { require: "code" });
    expect(unlinkedWarning(atlas.warnings)).toEqual([
      expect.stringContaining(
        "7 element(s) call an API or change state but have no ref, so no flow can point at them: web--checkout (a), web--checkout (b), web--checkout (c), web--checkout (d), web--checkout (e), and 2 more;",
      ),
    ]);
  });
});

describe("shared layouts", () => {
  const logout = (id: string, parentId: string, ref: string) => ({
    id,
    kind: "element",
    role: "button",
    label: "Log out",
    parentId,
    ref,
    action: "logs out",
    sourceIds: ["pay"],
  });
  const callsLogout = (from: string) => ({
    id: `${from}-call`,
    from,
    toRef: "api:auth/logout",
    kind: "calls",
    sourceIds: ["pay"],
  });

  function layoutBoard(layout = true) {
    return {
      schemaVersion: 1,
      title: "Layout",
      question: "What is in the shared header?",
      nodes: [
        { ...screen("layout", "web:layout", "r-cart"), ...(layout ? { layout: true } : {}) },
        logout("logout", "layout", "web:layout/header-logout"),
      ],
      edges: [callsLogout("logout")],
      sources: [src.cart, src.pay],
    };
  }

  function routeBoard(name: "cart" | "checkout", layouts = ["web:layout"]) {
    return {
      schemaVersion: 1,
      title: name,
      question: `What is on ${name}?`,
      nodes: [
        { ...screen(name, `web:${name}`, `r-${name}`), layouts },
        logout("logout", name, `${layouts[0]}/header-logout`),
      ],
      edges: [callsLogout("logout")],
      sources: [src[name], src.pay],
    };
  }

  const flowWarning = (warnings: string[] | undefined) =>
    (warnings ?? []).filter((w) => w.includes("have no flow yet"));
  // The endpoint the button calls is not drawn here, so its ref dangles; that is not under test.
  const layoutProblems = (problems: Array<{ path: string; message: string }>) =>
    problems.filter((p) => p.path !== "api:auth/logout");

  test("screens carry the layout's ref without defining it twice; one flow covers them all", async () => {
    write("overview-web.board.json", overview());
    write("web--layout.board.json", layoutBoard());
    write("web--cart.board.json", routeBoard("cart"));
    write("web--checkout.board.json", routeBoard("checkout"));
    const atlas = await buildAtlas(dir, root);
    expect(layoutProblems(atlas.problems)).toEqual([]);
    const entry = atlas.refs.find((r) => r.ref === "web:layout/header-logout");
    expect(entry?.definedIn).toEqual([
      { slug: "web--layout", nodeId: "logout", kind: "element", label: "Log out", role: "button" },
    ]);
    expect(entry?.usedIn.map((u) => u.slug)).toEqual(["web--cart", "web--checkout"]);
    expect(entry?.needsFlow).toBe(true);
    const layout = atlas.refs.find((r) => r.ref === "web:layout");
    expect(layout?.definedIn).toEqual([
      { slug: "web--layout", nodeId: "layout", kind: "screen", label: "layout", layout: true },
    ]);
    expect(layout?.usedIn).toEqual([
      { slug: "web--cart", nodeId: "cart", asLayout: true },
      { slug: "web--checkout", nodeId: "checkout", asLayout: true },
    ]);
    expect(flowWarning(atlas.warnings)).toEqual([
      expect.stringContaining("1 element(s) that call an API or change state have no flow yet"),
    ]);

    write("log-out.board.json", {
      schemaVersion: 1,
      title: "Log out",
      question: "How does a user log out?",
      nodes: [
        {
          id: "click",
          kind: "step",
          label: "Clicks log out",
          ref: "web:layout/header-logout",
          sourceIds: ["pay"],
        },
      ],
      sources: [src.pay],
    });
    expect(flowWarning((await buildAtlas(dir, root)).warnings)).toEqual([]);
  });

  test("a screen's copy asks for a flow even when the layout board draws no call", async () => {
    write("web--layout.board.json", { ...layoutBoard(), edges: [] });
    write("web--cart.board.json", routeBoard("cart"));
    const atlas = await buildAtlas(dir, root);
    expect(atlas.refs.find((r) => r.ref === "web:layout/header-logout")?.needsFlow).toBe(true);
  });

  test("a layout that is not marked layout, or that no board draws, is a problem", async () => {
    write("web--layout.board.json", layoutBoard(false));
    write("web--cart.board.json", routeBoard("cart"));
    write("web--checkout.board.json", routeBoard("checkout", ["web:footer"]));
    const messages = layoutProblems((await buildAtlas(dir, root)).problems).map((p) => p.message);
    expect(messages).toEqual([
      expect.stringContaining(
        "`web:footer` is used in web--checkout (checkout) but no board defines it",
      ),
      expect.stringContaining("`web:footer/header-logout` is used in web--checkout (logout)"),
      expect.stringContaining(
        "`web:layout` is listed in the layouts of web--cart (cart) but is not a layout",
      ),
    ]);
  });
});
