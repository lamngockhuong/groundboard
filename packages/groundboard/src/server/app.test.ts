import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { RenderBoardResult } from "../pipeline.ts";
import { type AppOptions, createApp, MAX_BODY_BYTES, MAX_OVERLAY_BODY_BYTES } from "./app.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const board = JSON.parse(
  readFileSync(path.join(repoRoot, "examples", "checkout-flow.board.json"), "utf8"),
);

/** A request as if it came from `address` over a real socket. */
function env(address = "203.0.113.7") {
  return { incoming: { socket: { remoteAddress: address } } };
}

function post(
  app: ReturnType<typeof createApp>["app"],
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  address?: string,
) {
  return app.request(
    url,
    {
      method: "POST",
      headers: { host: "localhost:8787", "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    env(address),
  );
}

const mcpHeaders = {
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": "2026-07-28",
};
const mcpListTools = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
  params: {
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" },
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  },
};

/** Headers a 2026-07-28 HTTP client sends; they must agree with the JSON-RPC body. */
function mcpHeadersFor(body: { method: string; params?: Record<string, unknown> }) {
  const name = body.params?.name;
  return {
    ...mcpHeaders,
    "mcp-method": body.method,
    ...(typeof name === "string" ? { "mcp-name": name } : {}),
  };
}

// biome-ignore lint/suspicious/noExplicitAny: response bodies are inspected loosely in tests
type Json = Record<string, any>;
const json = async (res: Response): Promise<Json> => (await res.json()) as Json;

async function mcpToolNames(response: Response): Promise<string[]> {
  const text = await response.text();
  const json = text.startsWith("{")
    ? text
    : (text.split("\n").find((l) => l.startsWith("data:")) ?? "").slice(5);
  return (JSON.parse(json).result.tools as Array<{ name: string }>).map((t) => t.name).sort();
}

function get(
  app: ReturnType<typeof createApp>["app"],
  url: string,
  headers: Record<string, string> = {},
  address?: string,
) {
  return app.request(url, { headers: { host: "localhost:8787", ...headers } }, env(address));
}

function make(options: AppOptions = {}) {
  return createApp({ webRoot: path.join(repoRoot, "no-viewer-here"), ...options });
}

describe("HTTP server", () => {
  test("GET /healthz", async () => {
    const res = await get(make().app, "/healthz");
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true });
  });

  test("POST /api/render renders and says sources were not checked", async () => {
    const { app, close } = make();
    const res = await post(app, "/api/render", { board, direction: "down" });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.scene.type).toBe("excalidraw");
    // The example cites its design notes as code, which adds a "cites a document" warning.
    expect(body.warnings.filter((w: string) => !/cites a document as code/.test(w))).toEqual([
      expect.stringMatching(/sources not checked/),
    ]);
    const status = body.scene.elements.find((e: { id: string }) => e.id === "title-status");
    expect(status.text).toBe("Sources NOT checked");
    await close();
  }, 20_000);

  test("POST /api/render returns 422 with issues for an invalid board", async () => {
    const bad = structuredClone(board);
    bad.edges[0].from = "nope";
    const res = await post(make().app, "/api/render", { board: bad });
    expect(res.status).toBe(422);
    expect((await json(res)).issues).toEqual([expect.objectContaining({ path: "edges[0].from" })]);
  });

  test("POST /api/validate returns issues", async () => {
    const res = await post(make().app, "/api/validate", { board });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, issues: [] });
  });

  test("rejects a body over 1 MB with 413", async () => {
    const big = JSON.stringify({ board: { pad: "x".repeat(MAX_BODY_BYTES + 10) } });
    for (const url of ["/api/render", "/mcp"]) {
      const res = await post(make().app, url, big, mcpHeaders);
      expect(res.status, url).toBe(413);
    }
  });

  test("rejects a malformed request with 400", async () => {
    expect((await post(make().app, "/api/render", { nope: 1 })).status).toBe(400);
    expect((await post(make().app, "/api/render", { board, direction: "up" })).status).toBe(400);
  });

  test("/mcp lists the tools", async () => {
    const res = await post(make().app, "/mcp", mcpListTools, mcpHeadersFor(mcpListTools));
    expect(res.status).toBe(200);
    expect(await mcpToolNames(res)).toEqual([
      "check_atlas",
      "get_board_schema",
      "render_board",
      "validate_board",
    ]);
  });

  test("an unknown Host is rejected on /mcp and /api/render", async () => {
    const { app } = make();
    for (const url of ["/mcp", "/api/render"]) {
      const res = await post(app, url, url === "/mcp" ? mcpListTools : { board }, {
        ...mcpHeadersFor(mcpListTools),
        host: "evil.example",
      });
      expect(res.status, url).toBe(403);
    }
  });

  test("allowed hosts are accepted, others and foreign origins are not", async () => {
    const { app } = make({ host: "0.0.0.0", allowedHosts: ["board.example.com"] });
    const ok = await post(app, "/api/validate", { board }, { host: "board.example.com" });
    expect(ok.status).toBe(200);
    const local = await get(app, "/healthz", { host: "127.0.0.1:8787" });
    expect(local.status).toBe(200);
    expect((await post(app, "/api/validate", { board }, { host: "other.example" })).status).toBe(
      403,
    );
    const crossSite = await post(
      app,
      "/api/validate",
      { board },
      {
        host: "board.example.com",
        origin: "https://evil.example",
      },
    );
    expect(crossSite.status).toBe(403);
  });

  test("a layout over the time limit answers 503", async () => {
    const res = await post(make({ layoutTimeoutMs: 1 }).app, "/api/render", { board });
    expect(res.status).toBe(503);
    expect((await json(res)).error).toMatch(/did not finish within 1 ms/);
  });

  test("/healthz answers while two slow layouts run, and a full queue answers 503", async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const render = async (): Promise<RenderBoardResult> => {
      await released;
      return { ok: false, issues: [], warnings: [], sourcesChecked: null };
    };
    const { app } = make({ render, maxConcurrentLayouts: 2, maxQueuedLayouts: 0 });
    const slow = [
      post(app, "/api/render", { board }, {}, "198.51.100.11"),
      post(app, "/api/render", { board }, {}, "198.51.100.12"),
    ];
    await new Promise((r) => setTimeout(r, 20));
    const started = performance.now();
    const health = await get(app, "/healthz");
    expect(health.status).toBe(200);
    expect(performance.now() - started).toBeLessThan(500);
    const busy = await post(app, "/api/render", { board }, {}, "198.51.100.13");
    expect(busy.status).toBe(503);
    release();
    expect((await Promise.all(slow)).map((r) => r.status)).toEqual([422, 422]);
  });

  test("one client gets one layout at a time, on /api/render and over /mcp", async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const render = async (): Promise<RenderBoardResult> => {
      await released;
      return { ok: false, issues: [], warnings: [], sourcesChecked: null };
    };
    const { app } = make({ render, maxConcurrentLayouts: 2, maxQueuedLayouts: 8 });
    const first = post(app, "/api/render", { board }, {}, "198.51.100.21");
    await new Promise((r) => setTimeout(r, 20));
    const second = await post(app, "/api/render", { board }, {}, "198.51.100.21");
    expect(second.status).toBe(429);
    const call = {
      ...mcpListTools,
      method: "tools/call",
      params: { ...mcpListTools.params, name: "render_board", arguments: { board } },
    };
    const viaMcp = await post(app, "/mcp", call, mcpHeadersFor(call), "198.51.100.21");
    expect(await viaMcp.text()).toContain("already has a board being laid out");
    // Another client is not affected.
    const other = post(app, "/api/render", { board }, {}, "198.51.100.22");
    release();
    expect((await first).status).toBe(422);
    expect((await other).status).toBe(422);
  });

  test("rate limits per socket address and ignores a spoofed X-Forwarded-For", async () => {
    const { app } = make({ rateLimit: { limit: 2, windowMs: 60_000, maxKeys: 100 } });
    const send = (address: string, xff?: string) =>
      post(app, "/api/validate", { board }, xff ? { "x-forwarded-for": xff } : {}, address);
    expect((await send("198.51.100.1", "1.1.1.1")).status).toBe(200);
    expect((await send("198.51.100.1", "2.2.2.2")).status).toBe(200);
    // A new X-Forwarded-For value does not buy a fresh budget without --trust-proxy.
    expect((await send("198.51.100.1", "3.3.3.3")).status).toBe(429);
    expect((await send("198.51.100.2")).status).toBe(200);
    // /healthz is never rate limited.
    expect((await get(app, "/healthz", {}, "198.51.100.1")).status).toBe(200);
  });

  test("keys IPv6 clients by their /64", async () => {
    const { app } = make({ rateLimit: { limit: 1, windowMs: 60_000, maxKeys: 100 } });
    const send = (address: string) => post(app, "/api/validate", { board }, {}, address);
    expect((await send("2001:db8:1:2::1")).status).toBe(200);
    expect((await send("2001:db8:1:2:ffff::9")).status).toBe(429);
    expect((await send("2001:db8:1:3::1")).status).toBe(200);
  });

  test("uses X-Forwarded-For only from a trusted proxy", async () => {
    const { app } = make({
      trustProxy: ["10.0.0.0/8"],
      rateLimit: { limit: 1, windowMs: 60_000, maxKeys: 100 },
    });
    const send = (xff: string) =>
      post(app, "/api/validate", { board }, { "x-forwarded-for": xff }, "10.1.2.3");
    expect((await send("192.0.2.1")).status).toBe(200);
    expect((await send("192.0.2.2")).status).toBe(200);
    expect((await send("192.0.2.1")).status).toBe(429);
  });

  describe("with GROUNDBOARD_TOKEN", () => {
    const token = "s3cret-token";
    test.each([
      ["no token", {}],
      ["a wrong token", { authorization: "Bearer nope" }],
      ["a token of the right length", { authorization: `Bearer ${"x".repeat(token.length)}` }],
    ])("answers 401 to %s", async (_label, headers) => {
      const { app } = make({ token });
      for (const url of ["/api/render", "/mcp"]) {
        const res = await post(app, url, url === "/mcp" ? mcpListTools : { board }, {
          ...mcpHeadersFor(mcpListTools),
          ...headers,
        });
        expect(res.status, url).toBe(401);
      }
    });

    test("accepts the right token on /api/render and /mcp; /healthz stays open", async () => {
      const { app } = make({ token });
      const auth = { authorization: `Bearer ${token}` };
      expect((await post(app, "/api/render", { board }, auth)).status).toBe(200);
      const mcp = await post(app, "/mcp", mcpListTools, {
        ...mcpHeadersFor(mcpListTools),
        ...auth,
      });
      expect(mcp.status).toBe(200);
      expect(await mcpToolNames(mcp)).toContain("render_board");
      expect((await get(app, "/healthz")).status).toBe(200);
    }, 20_000);
  });

  test("render_board over /mcp refuses file arguments", async () => {
    const call = {
      ...mcpListTools,
      method: "tools/call",
      params: {
        ...mcpListTools.params,
        name: "render_board",
        arguments: { board, checkSourcesRoot: "/" },
      },
    };
    const res = await post(make().app, "/mcp", call, mcpHeadersFor(call));
    const text = await res.text();
    expect(text).toContain("no file access");
  });

  test("sets security headers", async () => {
    const res = await get(make().app, "/healthz");
    const csp = res.headers.get("content-security-policy");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("form-action 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("screen atlas", () => {
  const SECRET = "SECRET-FILE-CONTENT";
  let base: string;
  let project: string;
  let atlasDir: string;
  const screenBoard = {
    schemaVersion: 1,
    title: "Overview",
    question: "Which screens?",
    nodes: [
      {
        id: "cart",
        kind: "screen",
        label: "Cart",
        ref: "web:cart",
        platform: "web",
        layoutFrom: "code",
        sourceIds: ["r"],
      },
    ],
    sources: [{ id: "r", path: "src/routes.tsx", line: 1, quote: 'path="/cart"' }],
  };

  beforeAll(() => {
    base = mkdtempSync(path.join(tmpdir(), "groundboard-atlas-http-"));
    project = path.join(base, "project");
    atlasDir = path.join(project, ".groundboard");
    mkdirSync(path.join(project, "src"), { recursive: true });
    mkdirSync(atlasDir);
    writeFileSync(path.join(project, "src", "routes.tsx"), '<Route path="/cart" />\n');
    writeFileSync(path.join(project, ".env"), `TOKEN=${SECRET}\n`);
    writeFileSync(path.join(atlasDir, "overview-web.board.json"), JSON.stringify(screenBoard));
    const stale = structuredClone(screenBoard);
    stale.title = "Stale";
    stale.sources = [
      { id: "gone", path: "src/missing.tsx", line: 1, quote: "x" },
      { id: "moved", path: "src/routes.tsx", line: 9, quote: "x" },
    ];
    stale.nodes[0] = {
      ...stale.nodes[0],
      ref: "web:checkout",
      sourceIds: ["gone", "moved"],
    } as (typeof stale.nodes)[0];
    writeFileSync(path.join(atlasDir, "stale.board.json"), JSON.stringify(stale));
    writeFileSync(path.join(atlasDir, "broken.board.json"), JSON.stringify({ schemaVersion: 1 }));
    writeFileSync(path.join(base, "outside.board.json"), JSON.stringify(screenBoard));
    symlinkSync(path.join(base, "outside.board.json"), path.join(atlasDir, "linked.board.json"));
    symlinkSync(path.join(project, ".env"), path.join(atlasDir, "env.board.json"));
    mkdirSync(path.join(atlasDir, "sub"));
    writeFileSync(path.join(atlasDir, "sub", "secrets.json"), `{"token":"${SECRET}"}`);
    symlinkSync(
      path.join(atlasDir, "sub", "secrets.json"),
      path.join(atlasDir, "inner.board.json"),
    );
    execFileSync("mkfifo", [path.join(atlasDir, "pipe.board.json")]);
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  const withAtlas = (options: AppOptions = {}) =>
    make({ atlas: { dir: atlasDir, root: project }, ...options });

  const putTags = (
    app: ReturnType<typeof createApp>["app"],
    slug: string,
    body: unknown,
    contentType = "application/json",
  ) =>
    app.request(
      `/api/atlas/boards/${slug}/tags`,
      {
        method: "PUT",
        headers: { host: "localhost:8787", "content-type": contentType },
        body: JSON.stringify(body),
      },
      env("127.0.0.1"),
    );

  test("writes a board's tags into its file and nothing else, then lists them", async () => {
    const file = path.join(atlasDir, "tagme.board.json");
    writeFileSync(file, JSON.stringify(screenBoard));
    try {
      const { app } = withAtlas();
      expect(await json(await get(app, "/api/atlas"))).toMatchObject({ tagsEditable: true });
      const res = await putTags(app, "tagme", { tags: ["service-admin", "người tham gia"] });
      expect(res.status).toBe(200);
      const answer = await json(res);
      expect(answer).toEqual({
        ok: true,
        tags: ["service-admin", "người tham gia"],
        etag: createHash("sha256").update(readFileSync(file, "utf8")).digest("hex"),
      });
      const written = JSON.parse(readFileSync(file, "utf8"));
      expect(Object.keys(written).slice(0, 4)).toEqual([
        "schemaVersion",
        "title",
        "question",
        "tags",
      ]);
      expect({ ...written, tags: undefined }).toEqual({ ...screenBoard, tags: undefined });
      const listed = await json(await get(app, "/api/atlas"));
      expect(listed.boards.find((b: Json) => b.slug === "tagme").tags).toEqual([
        "service-admin",
        "người tham gia",
      ]);
      // No tags removes the field.
      expect((await putTags(app, "tagme", { tags: [] })).status).toBe(200);
      expect("tags" in JSON.parse(readFileSync(file, "utf8"))).toBe(false);
    } finally {
      rmSync(file, { force: true });
    }
  });

  test("refuses bad tags, bad boards, symlinks, other content types and non-loopback binds", async () => {
    const { app } = withAtlas();
    expect((await putTags(app, "overview-web", { tags: ["a", "a"] })).status).toBe(422);
    expect((await putTags(app, "overview-web", { tags: [" x"] })).status).toBe(422);
    expect((await putTags(app, "overview-web", { nope: 1 })).status).toBe(400);
    expect((await putTags(app, "overview-web", { tags: ["a"] }, "text/plain")).status).toBe(415);
    expect((await putTags(app, "broken", { tags: ["a"] })).status).toBe(409);
    expect((await putTags(app, "linked", { tags: ["a"] })).status).toBe(404);
    expect((await putTags(app, "missing", { tags: ["a"] })).status).toBe(404);
    expect((await putTags(app, "..%2Fx", { tags: ["a"] })).status).toBe(400);
    expect(readFileSync(path.join(base, "outside.board.json"), "utf8")).toBe(
      JSON.stringify(screenBoard),
    );
    const remote = withAtlas({
      host: "0.0.0.0",
      token: "t",
      allowedHosts: ["localhost"],
    });
    const res = await remote.app.request(
      "/api/atlas/boards/overview-web/tags",
      {
        method: "PUT",
        headers: {
          host: "localhost:8787",
          "content-type": "application/json",
          authorization: "Bearer t",
        },
        body: JSON.stringify({ tags: ["a"] }),
      },
      env("127.0.0.1"),
    );
    // Off a loopback bind the write routes do not exist.
    expect(res.status).toBe(404);
    expect(
      await json(await get(remote.app, "/api/atlas", { authorization: "Bearer t" })),
    ).not.toHaveProperty("tagsEditable");
  });

  describe("layout overlays", () => {
    const overlayFile = (slug: string) => path.join(atlasDir, `${slug}.overlay.json`);
    const sha = (text: string) => createHash("sha256").update(text).digest("hex");
    const putOverlay = (
      app: ReturnType<typeof createApp>["app"],
      slug: string,
      body: unknown,
      headers: Record<string, string> = {},
      address = "127.0.0.1",
    ) =>
      app.request(
        `/api/atlas/boards/${slug}/overlay`,
        {
          method: "PUT",
          headers: { host: "localhost:8787", "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        },
        env(address),
      );
    const overlay = (dx: number) => ({
      schemaVersion: 1,
      nodes: { cart: { dx, dy: 0 } },
      notes: [],
    });

    test("writes the first overlay, then each next one against the ETag it got", async () => {
      const slug = "overlaid";
      writeFileSync(path.join(atlasDir, `${slug}.board.json`), JSON.stringify(screenBoard));
      try {
        const { app } = withAtlas();
        expect((await get(app, `/api/atlas/boards/${slug}/overlay`)).status).toBe(404);
        const first = await putOverlay(app, slug, { overlay: overlay(10), expectedEtag: null });
        expect(first.status).toBe(200);
        const { etag } = await json(first);
        expect(etag).toBe(sha(readFileSync(overlayFile(slug), "utf8")));
        const served = await get(app, `/api/atlas/boards/${slug}/overlay`);
        expect(served.headers.get("etag")).toBe(`"${etag}"`);
        // Two saves in a row, each with the ETag the last one returned.
        const second = await putOverlay(app, slug, { overlay: overlay(20), expectedEtag: etag });
        expect(second.status).toBe(200);
        const third = await putOverlay(app, slug, {
          overlay: overlay(30),
          expectedEtag: (await json(second)).etag,
        });
        expect(third.status).toBe(200);
        // A stale ETag is refused with the current one.
        const stale = await putOverlay(app, slug, { overlay: overlay(40), expectedEtag: etag });
        expect(stale.status).toBe(409);
        expect((await json(stale)).etag).toBe(sha(readFileSync(overlayFile(slug), "utf8")));
        expect(JSON.parse(readFileSync(overlayFile(slug), "utf8")).nodes.cart.dx).toBe(30);
        // The board renders with the overlay applied.
        const rendered = await json(await get(app, `/api/atlas/boards/${slug}`));
        expect(rendered.status).toBe("ok");
      } finally {
        rmSync(overlayFile(slug), { force: true });
        rmSync(path.join(atlasDir, `${slug}.board.json`), { force: true });
      }
    }, 30_000);

    // Two tabs, or a tab and an agent's save: each client has its own slot, so they meet at the
    // board's lock, where the second finds the file no longer matches its ETag.
    test("two saves racing with one ETag: one wins, one gets 409", async () => {
      const slug = "raced";
      writeFileSync(path.join(atlasDir, `${slug}.board.json`), JSON.stringify(screenBoard));
      try {
        const { app } = withAtlas();
        const [a, b] = await Promise.all([
          putOverlay(app, slug, { overlay: overlay(1), expectedEtag: null }, {}, "127.0.0.2"),
          putOverlay(app, slug, { overlay: overlay(2), expectedEtag: null }, {}, "127.0.0.3"),
        ]);
        expect([a.status, b.status].sort()).toEqual([200, 409]);
      } finally {
        rmSync(overlayFile(slug), { force: true });
        rmSync(path.join(atlasDir, `${slug}.board.json`), { force: true });
      }
    });

    test("refuses an overlay without a board, an invalid one, a note with a link, other hosts", async () => {
      const { app } = withAtlas();
      expect(
        (await putOverlay(app, "nope", { overlay: overlay(1), expectedEtag: null })).status,
      ).toBe(404);
      expect(
        (await putOverlay(app, "overview-web", { overlay: { schemaVersion: 1 } })).status,
      ).toBe(422);
      const linked = {
        ...overlay(1),
        notes: [
          {
            id: "n",
            type: "rectangle",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            link: "https://x.example",
          },
        ],
      };
      expect((await putOverlay(app, "overview-web", { overlay: linked })).status).toBe(422);
      expect(
        (await putOverlay(app, "overview-web", { overlay: overlay(1), expectedEtag: "x" })).status,
      ).toBe(400);
      // DNS rebinding: a page on another name reaches the port but not the routes.
      for (const url of ["overlay", "tags"]) {
        const res = await app.request(
          `/api/atlas/boards/overview-web/${url}`,
          {
            method: "PUT",
            headers: { host: "evil.example", "content-type": "application/json" },
            body: JSON.stringify({ overlay: overlay(1), tags: [] }),
          },
          env("127.0.0.1"),
        );
        expect(res.status, url).toBe(403);
      }
      expect(existsSync(overlayFile("overview-web"))).toBe(false);
      const remote = withAtlas({ host: "0.0.0.0", token: "t", allowedHosts: ["localhost"] });
      const res = await putOverlay(
        remote.app,
        "overview-web",
        { overlay: overlay(1) },
        {
          authorization: "Bearer t",
        },
      );
      expect(res.status).toBe(404);
    });

    test("takes an overlay body over 1 MB, and refuses one over the overlay limit", async () => {
      const slug = "bigoverlay";
      writeFileSync(path.join(atlasDir, `${slug}.board.json`), JSON.stringify(screenBoard));
      try {
        const { app } = withAtlas();
        const note = (i: number) => ({
          id: `n${i}`,
          type: "text",
          x: i,
          y: 0,
          width: 10,
          height: 10,
          text: "x".repeat(1900),
        });
        // About 1 MB of request body, under the overlay file's own limit once indented.
        const big = { ...overlay(0), notes: Array.from({ length: 480 }, (_, i) => note(i)) };
        expect(JSON.stringify({ overlay: big }).length).toBeGreaterThan(MAX_BODY_BYTES * 0.85);
        const ok = await putOverlay(app, slug, { overlay: big, expectedEtag: null });
        expect(ok.status).toBe(200);
        const huge = await app.request(
          `/api/atlas/boards/${slug}/overlay`,
          {
            method: "PUT",
            headers: { host: "localhost:8787", "content-type": "application/json" },
            body: JSON.stringify({ overlay: overlay(0), pad: "x".repeat(MAX_OVERLAY_BODY_BYTES) }),
          },
          env("127.0.0.1"),
        );
        expect(huge.status).toBe(413);
        // Every other route keeps 1 MB.
        const render = await post(app, "/api/render", {
          board: {},
          pad: "x".repeat(MAX_BODY_BYTES),
        });
        expect(render.status).toBe(413);
      } finally {
        rmSync(overlayFile(slug), { force: true });
        rmSync(path.join(atlasDir, `${slug}.board.json`), { force: true });
      }
    });

    test("atlas check warns about an overlay that matches nothing and one with no board", async () => {
      const { buildAtlas } = await import("../atlas.ts");
      writeFileSync(
        overlayFile("overview-web"),
        JSON.stringify({ schemaVersion: 1, nodes: { ghost: { dx: 1, dy: 1 } }, notes: [] }),
      );
      writeFileSync(overlayFile("orphan"), JSON.stringify(overlay(1)));
      writeFileSync(overlayFile("stale"), "{ nope");
      try {
        const index = await buildAtlas(atlasDir, project);
        const warnings = (slug: string) => index.boards.find((b) => b.slug === slug)?.warnings;
        expect(warnings("overview-web")).toContain(
          "overlay: `ghost` is not on the board; its offset is ignored",
        );
        expect(warnings("stale")).toContain("stale.overlay.json ignored: not valid JSON");
        expect(index.warnings).toEqual(["orphan.overlay.json has no orphan.board.json beside it"]);
        expect(index.problems.map((p) => p.message).join(" ")).not.toContain("overlay");
      } finally {
        for (const slug of ["overview-web", "orphan", "stale"])
          rmSync(overlayFile(slug), { force: true });
      }
    });
  });

  describe("board saves", () => {
    const putBoard = (app: ReturnType<typeof createApp>["app"], slug: string, body: unknown) =>
      app.request(
        `/api/atlas/boards/${slug}`,
        {
          method: "PUT",
          headers: { host: "localhost:8787", "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        env("127.0.0.1"),
      );
    const sha = (text: string) => createHash("sha256").update(text).digest("hex");

    test("saves a board against its ETag, twice in a row, and refuses a stale or invalid one", async () => {
      const file = path.join(atlasDir, "edited.board.json");
      writeFileSync(file, JSON.stringify(screenBoard));
      try {
        const { app } = withAtlas();
        const edited = {
          ...screenBoard,
          nodes: [
            ...screenBoard.nodes,
            { id: "m-added", kind: "step", label: "By hand", manual: true },
          ],
        };
        const first = await putBoard(app, "edited", {
          board: edited,
          expectedEtag: sha(JSON.stringify(screenBoard)),
        });
        expect(first.status).toBe(200);
        const { etag } = await json(first);
        expect(etag).toBe(sha(readFileSync(file, "utf8")));
        expect(JSON.parse(readFileSync(file, "utf8")).nodes[1]).toEqual({
          id: "m-added",
          kind: "step",
          label: "By hand",
          manual: true,
        });
        const second = await putBoard(app, "edited", { board: screenBoard, expectedEtag: etag });
        expect(second.status).toBe(200);
        // The file changed behind the viewer's back (an agent wrote it): 409 with its ETag now.
        writeFileSync(file, JSON.stringify({ ...screenBoard, title: "Rewritten" }));
        const stale = await putBoard(app, "edited", {
          board: edited,
          expectedEtag: (await json(second)).etag,
        });
        expect(stale.status).toBe(409);
        expect((await json(stale)).etag).toBe(sha(readFileSync(file, "utf8")));
        // An invalid board is refused with its issues; a save needs an ETag.
        const invalid = await putBoard(app, "edited", {
          board: { ...screenBoard, nodes: [{ id: "x", kind: "step", label: "No source" }] },
          expectedEtag: sha(readFileSync(file, "utf8")),
        });
        expect(invalid.status).toBe(422);
        expect((await json(invalid)).issues[0].path).toBe("nodes[0].sourceIds");
        expect((await putBoard(app, "edited", { board: screenBoard })).status).toBe(400);
        expect(
          (await putBoard(app, "nope", { board: screenBoard, expectedEtag: sha("x") })).status,
        ).toBe(404);
      } finally {
        rmSync(file, { force: true });
      }
    }, 30_000);

    test("takes a 2 MB board, which no other route would", async () => {
      const file = path.join(atlasDir, "big.board.json");
      writeFileSync(file, JSON.stringify(screenBoard));
      try {
        const { app } = withAtlas();
        const big = {
          ...screenBoard,
          nodes: [
            ...screenBoard.nodes,
            ...Array.from({ length: 450 }, (_, i) => ({
              id: `n${i}`,
              kind: "note",
              label: "x".repeat(1900),
              detail: "y".repeat(1900),
            })),
          ],
        };
        expect(JSON.stringify(big).length).toBeGreaterThan(1.6 * 1024 * 1024);
        const res = await putBoard(app, "big", {
          board: big,
          expectedEtag: sha(JSON.stringify(screenBoard)),
        });
        expect(res.status).toBe(200);
        const overlayRoute = await app.request(
          "/api/atlas/boards/big/overlay",
          {
            method: "PUT",
            headers: { host: "localhost:8787", "content-type": "application/json" },
            body: JSON.stringify({ overlay: big }),
          },
          env("127.0.0.1"),
        );
        expect(overlayRoute.status).toBe(413);
      } finally {
        rmSync(file, { force: true });
      }
    }, 30_000);
  });

  test("is off by default: 404 on both routes and healthz says so", async () => {
    const { app } = make();
    expect((await get(app, "/api/atlas")).status).toBe(404);
    expect((await get(app, "/api/atlas/boards/overview-web")).status).toBe(404);
    expect(await json(await get(app, "/healthz"))).toMatchObject({ atlas: false });
  });

  test("lists the boards; a stale board names its broken sources and nothing about the files", async () => {
    const { app } = withAtlas();
    expect(await json(await get(app, "/healthz"))).toMatchObject({ atlas: true });
    const res = await get(app, "/api/atlas");
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as Json;
    expect(body.boards.map((b: Json) => [b.slug, b.status])).toEqual([
      ["broken", "invalid"],
      ["overview-web", "ok"],
      ["stale", "stale"],
    ]);
    const stale = body.boards.find((b: Json) => b.slug === "stale");
    expect(stale.staleSourceIds).toEqual(["gone", "moved"]);
    expect(stale.issues).toBeUndefined();
    expect(body.boards.find((b: Json) => b.slug === "broken").issues.length).toBeGreaterThan(0);
    for (const leak of ["not found", "lines", "symlink", "missing.tsx", SECRET, base]) {
      expect(text, leak).not.toContain(leak);
    }
  });

  test("serves the spec-stage atlas with grounding, and neither absolute paths nor mockup bytes", async () => {
    const spec = path.resolve(import.meta.dirname, "../../../../examples/fixtures/lifecycle/spec");
    const { app } = make({ atlas: { dir: path.join(spec, ".groundboard"), root: spec } });
    const res = await get(app, "/api/atlas");
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as Json;
    const signup = body.boards.find((b: Json) => b.slug === "web--signup");
    expect(signup).toMatchObject({
      status: "ok",
      grounding: { code: 0, spec: 6, none: 1 },
      uncheckedSources: 0,
      specOnlyTruncated: false,
    });
    expect(signup.specOnly).toContain("nodes[3]");
    expect(text).not.toContain(spec);
    expect(text).not.toContain("PNG");
    const mockup = readFileSync(path.join(spec, "design", "signup-mockup.png"));
    expect(text).not.toContain(mockup.subarray(16, 32).toString("base64"));
  });

  test("the committed spec-stage payload the viewer tests read is what /api/atlas serves", async () => {
    const lifecycle = path.resolve(import.meta.dirname, "../../../../examples/fixtures/lifecycle");
    const spec = path.join(lifecycle, "spec");
    const { app } = make({ atlas: { dir: path.join(spec, ".groundboard"), root: spec } });
    // The atlas id hashes the root's real path, which differs from machine to machine.
    const { atlasId, ...payload } = await json(await get(app, "/api/atlas"));
    expect(atlasId).toMatch(/^[0-9a-f]{32}$/);
    const served = `${JSON.stringify(payload, null, 2)}\n`;
    const file = path.join(lifecycle, "spec-public-atlas.json");
    if (process.env.UPDATE_ATLAS_PAYLOAD === "1") writeFileSync(file, served);
    // Regenerate with UPDATE_ATLAS_PAYLOAD=1 pnpm vitest run packages/groundboard/src/server
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(JSON.parse(served));
  });

  test("renders a board, and a stale one with a warning status instead of an error", async () => {
    const { app, close } = withAtlas();
    const ok = await get(app, "/api/atlas/boards/overview-web");
    expect(ok.status).toBe(200);
    const body = await json(ok);
    expect(body.status).toBe("ok");
    expect(body.scene.type).toBe("excalidraw");
    const stale = await get(app, "/api/atlas/boards/stale");
    expect(stale.status).toBe(200);
    const staleBody = await json(stale);
    expect(staleBody).toMatchObject({ status: "stale", staleSourceIds: ["gone", "moved"] });
    expect(staleBody.scene.elements.find((e: Json) => e.id === "title-status").text).toBe(
      "Sources NOT checked",
    );
    expect(JSON.stringify(staleBody)).not.toContain("not found");
    expect((await get(app, "/api/atlas/boards/broken")).status).toBe(422);
    await close();
  }, 30_000);

  test("refuses bad slugs, symlinks, FIFOs and files that are not boards", async () => {
    const { app } = withAtlas();
    for (const slug of [".env", "..%2f.env", "..%2F..%2Fetc%2Fpasswd", "a.b", "x".repeat(101)]) {
      const res = await get(app, `/api/atlas/boards/${slug}`);
      expect(res.status, slug).toBe(400);
    }
    for (const slug of ["..", "%2e%2e"]) {
      // The URL parser folds these into the parent path before routing; nothing is read.
      expect((await get(app, `/api/atlas/boards/${slug}`)).status, slug).not.toBe(200);
    }
    for (const slug of ["linked", "env", "inner", "pipe", "nope"]) {
      const res = await get(app, `/api/atlas/boards/${slug}`);
      expect(res.status, slug).toBe(404);
      expect(await res.text()).not.toContain(SECRET);
    }
    const list = await json(await get(app, "/api/atlas"));
    expect(list.boards.map((b: Json) => b.slug)).not.toContain("linked");
  });

  test("serves a board file as written, with its SHA-256 as the ETag", async () => {
    const { app } = withAtlas();
    const res = await get(app, "/api/atlas/boards/overview-web/source");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(readFileSync(path.join(atlasDir, "overview-web.board.json"), "utf8"));
    const hash = createHash("sha256").update(text).digest("hex");
    expect(res.headers.get("etag")).toBe(`"${hash}"`);
    // Invalid boards are served too: the file is what the viewer asks for, not its render.
    expect((await get(app, "/api/atlas/boards/broken/source")).status).toBe(200);
    for (const slug of ["a.b", "..%2f.env"]) {
      expect((await get(app, `/api/atlas/boards/${slug}/source`)).status, slug).toBe(400);
    }
    for (const slug of ["linked", "env", "inner", "pipe", "nope"]) {
      const missing = await get(app, `/api/atlas/boards/${slug}/source`);
      expect(missing.status, slug).toBe(404);
      expect(await missing.text()).not.toContain(SECRET);
    }
  });

  test("packs every board file into one zip, with the rendered scenes when asked", async () => {
    const { app, close } = withAtlas();
    const plain = await get(app, "/api/atlas/export.zip");
    expect(plain.status).toBe(200);
    expect(plain.headers.get("content-type")).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await plain.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual([
      ".groundboard/broken.board.json",
      ".groundboard/overview-web.board.json",
      ".groundboard/stale.board.json",
    ]);
    expect(strFromU8(files[".groundboard/overview-web.board.json"] as Uint8Array)).toBe(
      readFileSync(path.join(atlasDir, "overview-web.board.json"), "utf8"),
    );
    expect(JSON.stringify(Object.keys(files))).not.toContain("linked");

    const withScenes = await get(app, "/api/atlas/export.zip?include=excalidraw");
    const all = unzipSync(new Uint8Array(await withScenes.arrayBuffer()));
    expect(Object.keys(all).sort()).toEqual([
      ".groundboard/broken.board.json",
      ".groundboard/overview-web.board.json",
      ".groundboard/overview-web.excalidraw",
      ".groundboard/stale.board.json",
      ".groundboard/stale.excalidraw",
      "errors.txt",
    ]);
    const scene = JSON.parse(strFromU8(all[".groundboard/overview-web.excalidraw"] as Uint8Array));
    expect(scene.type).toBe("excalidraw");
    expect(strFromU8(all["errors.txt"] as Uint8Array)).toMatch(
      /^broken\.board\.json: not rendered/,
    );
    for (const content of Object.values(all)) expect(strFromU8(content)).not.toContain(SECRET);
    await close();
  }, 30_000);

  test("zips a 200-board atlas in one request", async () => {
    const dir = path.join(base, "big", ".groundboard");
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 200; i += 1) {
      writeFileSync(path.join(dir, `b${String(i).padStart(3, "0")}.board.json`), "{}");
    }
    const { app } = make({ atlas: { dir, root: path.join(base, "big") } });
    const res = await get(app, "/api/atlas/export.zip");
    expect(res.status).toBe(200);
    expect(Object.keys(unzipSync(new Uint8Array(await res.arrayBuffer())))).toHaveLength(200);
  });

  test("goes through the host, origin and token checks of /api/render", async () => {
    const token = "s3cret-token";
    const { app } = withAtlas({ host: "0.0.0.0", allowedHosts: ["atlas.example.com"], token });
    const auth = { host: "atlas.example.com", authorization: `Bearer ${token}` };
    for (const url of [
      "/api/atlas",
      "/api/atlas/boards/overview-web",
      "/api/atlas/boards/overview-web/source",
      "/api/atlas/export.zip",
    ]) {
      expect((await get(app, url, { host: "atlas.example.com" })).status, url).toBe(401);
      expect((await get(app, url, { ...auth, host: "evil.example" })).status, url).toBe(403);
      expect((await get(app, url, { ...auth, origin: "https://evil.example" })).status, url).toBe(
        403,
      );
      expect((await get(app, url, auth)).status, url).toBe(200);
    }
  }, 30_000);

  test("refuses to start on a public address without both a token and allowed hosts", () => {
    const atlas = { dir: atlasDir, root: project };
    expect(() => createApp({ host: "0.0.0.0", atlas })).toThrow(/GROUNDBOARD_TOKEN/);
    expect(() => createApp({ host: "0.0.0.0", atlas, token: "t" })).toThrow(/ALLOWED_HOSTS/);
    expect(() => createApp({ host: "0.0.0.0", atlas, allowedHosts: ["a.example"] })).toThrow();
    expect(() => createApp({ host: "127.0.0.1", atlas })).not.toThrow();
    expect(() =>
      createApp({ host: "0.0.0.0", atlas, token: "t", allowedHosts: ["a.example"] }),
    ).not.toThrow();
  });

  test("one client can load the index while its board is laid out", async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const render = async (): Promise<RenderBoardResult> => {
      await released;
      return { ok: false, issues: [], warnings: [], sourcesChecked: null };
    };
    const { app } = withAtlas({ render, maxConcurrentLayouts: 2, maxQueuedLayouts: 2 });
    const board = get(app, "/api/atlas/boards/overview-web", {}, "198.51.100.41");
    await new Promise((r) => setTimeout(r, 20));
    const index = await get(app, "/api/atlas", {}, "198.51.100.41");
    expect(index.status).toBe(200);
    release();
    expect((await board).status).toBe(422);
  });

  test("a full gate answers 503 on the board route", async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const render = async (): Promise<RenderBoardResult> => {
      await released;
      return { ok: false, issues: [], warnings: [], sourcesChecked: null };
    };
    const { app } = withAtlas({ render, maxConcurrentLayouts: 1, maxQueuedLayouts: 0 });
    const first = get(app, "/api/atlas/boards/overview-web", {}, "198.51.100.31");
    await new Promise((r) => setTimeout(r, 20));
    const busy = await get(app, "/api/atlas/boards/overview-web", {}, "198.51.100.32");
    expect(busy.status).toBe(503);
    release();
    expect((await first).status).toBe(422);
  });
});
