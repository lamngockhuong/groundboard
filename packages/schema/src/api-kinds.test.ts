import { describe, expect, test } from "vitest";
import { boardKindOf, refsOf } from "./atlas-shape.ts";
import { boardClaims } from "./grounding.ts";
import { lintBoardText } from "./lint-text.ts";
import { parseBoard } from "./validate.ts";

const source = { id: "r", path: "server/routes.ts", line: 1, quote: "router.post(...)" };

const apiBoard = (endpoints: Array<Record<string, unknown>>) => ({
  schemaVersion: 1,
  title: "Orders API",
  question: "Which endpoints?",
  nodes: [
    { id: "orders", kind: "resource", label: "Orders", ref: "api:orders", pathPrefix: "/v1" },
    ...endpoints.map((e, i) => ({
      id: `e${i}`,
      kind: "endpoint",
      label: `Endpoint ${i}`,
      parentId: "orders",
      sourceIds: ["r"],
      ...e,
    })),
  ],
  sources: [source],
});

const messages = (input: unknown) => {
  const result = parseBoard(input);
  return result.ok ? [] : result.error.map((i) => `${i.path}: ${i.message}`);
};

describe("API resources and endpoints", () => {
  test("a resource of endpoints is valid, an API board, and its refs are defined", () => {
    const board = apiBoard([
      { method: "POST", path: "/v1/orders", ref: "api:orders/post" },
      { method: "GET", path: "/v1/orders/:id/items", ref: "api:orders/get-id-items" },
    ]);
    const parsed = parseBoard(board);
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (!parsed.ok) return;
    expect(boardKindOf(parsed.value)).toBe("api");
    expect(refsOf(parsed.value).defined.map((d) => d.ref)).toEqual([
      "api:orders",
      "api:orders/post",
      "api:orders/get-id-items",
    ]);
    expect(lintBoardText(parsed.value)).toEqual([]);
  });

  test("an endpoint needs a resource, a method, a path that starts with / and a ref in its resource", () => {
    expect(messages(apiBoard([{ path: "/v1/orders", ref: "api:orders/post" }]))).toContain(
      "nodes[1].method: endpoint `e0` needs a method: GET, POST, PUT, PATCH, DELETE, HEAD or OPTIONS",
    );
    expect(
      messages(apiBoard([{ method: "GET", path: "orders", ref: "api:orders/get" }])),
    ).toContain("nodes[1].path: endpoint `e0` path `orders` must start with /");
    expect(
      messages(apiBoard([{ method: "GET", path: "/v1/orders", ref: "api:users/get" }])).join(" "),
    ).toContain("so its ref must start with `api:orders/`");
    const orphan = apiBoard([
      { method: "GET", path: "/v1/orders", ref: "api:orders/get", parentId: "x" },
    ]);
    expect(messages(orphan).join(" ")).toContain("needs parentId naming a resource node");
  });

  test("two endpoints with one method and path are refused; one slug twice takes a suffix", () => {
    const twice = apiBoard([
      { method: "GET", path: "/v1/orders/:id", ref: "api:orders/get-id" },
      { method: "GET", path: "/v1/orders/:id", ref: "api:orders/get-id-2" },
    ]);
    expect(messages(twice).join(" ")).toContain("are both GET /v1/orders/:id");
    const suffixed = apiBoard([
      { method: "GET", path: "/v1/orders/{id}", ref: "api:orders/get-id" },
      { method: "GET", path: "/v1/orders/id", ref: "api:orders/get-id-2" },
    ]);
    const parsed = parseBoard(suffixed);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(lintBoardText(parsed.value)).toEqual([]);
  });

  test("a ref that is not the one the method and path give is only a warning", () => {
    const parsed = parseBoard(
      apiBoard([{ method: "POST", path: "/v1/orders", ref: "api:orders/create" }]),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(lintBoardText(parsed.value)).toEqual([
        "nodes[1].ref `api:orders/create` differs from `api:orders/post`, the ref its method and path give",
      ]);
    }
  });

  test("method, path and pathPrefix belong to endpoints and resources only", () => {
    const board = apiBoard([]);
    board.nodes.push({
      id: "s",
      kind: "step",
      label: "Step",
      method: "GET",
      sourceIds: ["r"],
    } as never);
    expect(messages(board).join(" ")).toContain("method is only allowed on `endpoint` nodes");
  });
});

describe("endpoint guards", () => {
  const guarded = (guards: unknown, extra: Record<string, unknown> = {}) =>
    apiBoard([{ method: "POST", path: "/v1/orders", ref: "api:orders/post", guards, ...extra }]);

  test("guards citing the line that attaches them are valid and add no claim", () => {
    const board = guarded([
      { name: "requireCustomer", sourceIds: ["r"] },
      { name: "role: admin", sourceIds: ["r"] },
    ]);
    const parsed = parseBoard(board);
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (!parsed.ok) return;
    const plain = parseBoard(
      apiBoard([{ method: "POST", path: "/v1/orders", ref: "api:orders/post" }]),
    );
    if (!plain.ok) throw new Error("plain board is invalid");
    expect(boardClaims(parsed.value)).toEqual(boardClaims(plain.value));
  });

  test("an empty list says the handler was read and has no guard", () => {
    const parsed = parseBoard(guarded([]));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.nodes[1]?.guards).toEqual([]);
  });

  test("a guard needs a source that can back it, unless the endpoint is manual", () => {
    const unquoted = guarded([{ name: "requireCustomer", sourceIds: ["bare"] }]);
    unquoted.sources.push({ id: "bare", path: "server/auth.ts", line: 3 } as never);
    expect(messages(unquoted)).toContain(
      "nodes[1].guards[0].sourceIds: guard `requireCustomer` of endpoint `e0` cites no source that can back it; cite the line that attaches it to the route, or a quoted code source, a doc source, a figma source, a mockup with a path, or a link with a quote",
    );
    expect(messages(guarded([{ name: "auth", sourceIds: ["nope"] }]))).toContain(
      "nodes[1].guards[0].sourceIds[0]: guard `auth` of endpoint `e0` cites source `nope`, which is not a source id",
    );
    expect(messages(guarded([{ name: "auth" }], { manual: true }))).toEqual([]);
  });

  test("at most eight guards, and only on endpoints", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `g${i}`, sourceIds: ["r"] }));
    expect(messages(guarded(many))).toContain(
      "nodes[1].guards: nodes[1].guards has more than 8 items",
    );
    const board = apiBoard([]);
    (board.nodes[0] as Record<string, unknown>).guards = [];
    expect(messages(board).join(" ")).toContain("guards is only allowed on `endpoint` nodes");
  });

  test("a guard name that looks like an email is a warning", () => {
    const parsed = parseBoard(guarded([{ name: "allow ana@example.com", sourceIds: ["r"] }]));
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(lintBoardText(parsed.value).join(" ")).toContain("nodes[1].guards[0].name");
  });
});

describe("endpoint handlers", () => {
  const withHandler = (handler: unknown, extra: Record<string, unknown> = {}) =>
    apiBoard([{ method: "POST", path: "/v1/orders", ref: "api:orders/post", handler, ...extra }]);

  test("a handler names the board that explains it and cites the line that makes it so", () => {
    for (const shape of ["flow", "state", "sequence"]) {
      expect(messages(withHandler({ shape, sourceIds: ["r"] }))).toEqual([]);
    }
    expect(messages(withHandler({ shape: "chart", sourceIds: ["r"] })).join(" ")).toContain(
      "nodes[1].handler.shape",
    );
  });

  test("a handler needs a source that can back it unless the endpoint is manual, and only on endpoints", () => {
    expect(messages(withHandler({ shape: "flow" }))).toContain(
      "nodes[1].handler.sourceIds: handler of endpoint `e0` cites no source that can back its logic; cite the line that branches, changes state or calls out, or a quoted code source, a doc source, a figma source, a mockup with a path, or a link with a quote",
    );
    expect(messages(withHandler({ shape: "flow" }, { manual: true }))).toEqual([]);
    const board = apiBoard([]);
    (board.nodes[0] as Record<string, unknown>).handler = { shape: "flow", sourceIds: ["r"] };
    expect(messages(board).join(" ")).toContain("handler is only allowed on `endpoint` nodes");
  });
});

describe("calls edges", () => {
  const screen = (edge: Record<string, unknown>) => ({
    schemaVersion: 1,
    title: "Checkout",
    question: "What does Pay do?",
    nodes: [
      {
        id: "s",
        kind: "screen",
        label: "Checkout",
        ref: "web:checkout",
        platform: "web",
        layoutFrom: "code",
        sourceIds: ["c"],
      },
      {
        id: "pay",
        kind: "element",
        role: "button",
        label: "Pay",
        parentId: "s",
        action: "Pays",
        sourceIds: ["c"],
      },
    ],
    edges: [{ id: "call", from: "pay", kind: "calls", ...edge }],
    sources: [{ id: "c", path: "src/checkout.tsx", line: 1, quote: "fetch(...)" }],
  });

  test("a call from a button to an endpoint on another board is a claim backed by code", () => {
    const parsed = parseBoard(screen({ toRef: "api:orders/post", sourceIds: ["c"] }));
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (parsed.ok) {
      expect(boardClaims(parsed.value).find((c) => c.id === "call")?.grounding).toBe("code");
      expect(refsOf(parsed.value).used).toEqual([
        { ref: "api:orders/post", nodeId: "pay", edgeId: "call" },
      ]);
    }
  });

  test("a call without a source is refused unless manual, and counts as none then", () => {
    expect(messages(screen({ toRef: "api:orders/post" })).join(" ")).toContain(
      "cites no source that can back the call",
    );
    const manual = parseBoard(screen({ toRef: "api:orders/post", manual: true }));
    expect(manual.ok).toBe(true);
    if (manual.ok)
      expect(boardClaims(manual.value).find((c) => c.id === "call")?.grounding).toBe("none");
  });

  test("toRef must be in the namespace and at the level the edge kind takes", () => {
    expect(messages(screen({ toRef: "web:home", sourceIds: ["c"] })).join(" ")).toContain(
      "is in namespace web; calls targets an endpoint ref",
    );
    expect(messages(screen({ toRef: "api:orders", sourceIds: ["c"] })).join(" ")).toContain(
      "must name an endpoint ref",
    );
    const flow = screen({ toRef: "api:orders/post", sourceIds: ["c"] });
    (flow.edges[0] as Record<string, unknown>).kind = "flow";
    expect(messages(flow).join(" ")).toContain("edges, not on `flow`");
  });
});
