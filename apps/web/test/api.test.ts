import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATLAS_BOARD_ENDPOINT,
  ATLAS_ENDPOINT,
  clearToken,
  fetchAtlas,
  fetchAtlasBoard,
  fetchHealth,
  HEALTH_ENDPOINT,
  readToken,
  STATIC_ATLAS_URL,
  STATIC_BOARD_URL,
  saveBoardTags,
  saveToken,
  toAtlas,
} from "../src/api.ts";

const scene = { type: "excalidraw", version: 2, elements: [{ id: "x" }], appState: {}, files: {} };

function respond(status: number, body: unknown) {
  return vi.fn<typeof fetch>(async () =>
    typeof body === "string"
      ? new Response(body, { status })
      : new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
  );
}

const sentHeaders = (fetchImpl: ReturnType<typeof respond>) =>
  (fetchImpl.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;

beforeEach(() => {
  clearToken();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bearer token", () => {
  const atlas = { boards: [], refs: [], problems: [] };

  it("surfaces a 401 as an unauthorized result, then sends the saved token as a bearer", async () => {
    const first = await fetchAtlas(respond(401, { error: "unauthorized" }), false);
    expect(first).toEqual({ status: "unauthorized", rejected: false });

    saveToken("s3cret");
    const fetchImpl = respond(200, atlas);
    const second = await fetchAtlas(fetchImpl, false);
    expect(second.status).toBe("ok");
    expect(sentHeaders(fetchImpl).Authorization).toBe("Bearer s3cret");
    expect(sessionStorage.getItem("groundboard.token")).toBe("s3cret");
  });

  it("drops a token the server rejects and reports it as rejected", async () => {
    saveToken("wrong");
    const result = await fetchAtlas(respond(401, { error: "unauthorized" }), false);
    expect(result).toEqual({ status: "unauthorized", rejected: true });
    expect(readToken()).toBeNull();
  });

  it("keeps the token in memory when sessionStorage throws", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(() => saveToken("mem-only")).not.toThrow();
    expect(readToken()).toBe("mem-only");
    const fetchImpl = respond(200, atlas);
    await fetchAtlas(fetchImpl, false);
    expect(sentHeaders(fetchImpl).Authorization).toBe("Bearer mem-only");
    expect(() => clearToken()).not.toThrow();
    expect(readToken()).toBeNull();
  });
});

describe("saveToken", () => {
  afterEach(() => clearToken());

  it("trims the token and refuses one that cannot be sent as a header", () => {
    expect(saveToken("  abc-123  ")).toBe(true);
    expect(readToken()).toBe("abc-123");
    clearToken();
    for (const bad of ["", "has space", "smart’quote", "nbsp here"]) {
      expect(saveToken(bad), JSON.stringify(bad)).toBe(false);
      expect(readToken()).toBeNull();
    }
  });
});

const atlas = {
  boards: [
    {
      slug: "web--checkout",
      title: "Checkout",
      kind: "screen",
      status: "stale",
      layoutFrom: ["figma"],
      uncheckedSources: 1,
      grounding: { code: 3, spec: 0, none: 0 },
      specOnly: [],
      specOnlyTruncated: false,
      staleSourceIds: ["s1"],
      warnings: [],
    },
  ],
  refs: [
    {
      ref: "web:checkout",
      definedIn: [{ slug: "web--checkout", nodeId: "checkout", kind: "screen" }],
      usedIn: [],
    },
  ],
  problems: [],
};

describe("atlas calls", () => {
  it("reads the data only from /healthz, /api/atlas and /api/atlas/boards/:slug", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url === HEALTH_ENDPOINT) return Response.json({ ok: true, atlas: true });
      if (url === ATLAS_ENDPOINT) return Response.json(atlas);
      return Response.json({ scene, status: "stale", warnings: [], staleSourceIds: ["s1"] });
    });
    expect(await fetchHealth(fetchImpl)).toEqual({ atlas: true });
    const index = await fetchAtlas(fetchImpl);
    expect(index.status === "ok" && index.atlas.boards[0]).toMatchObject({
      slug: "web--checkout",
      status: "stale",
      staleSourceIds: ["s1"],
    });
    const board = await fetchAtlasBoard("web--checkout", fetchImpl);
    expect(board).toMatchObject({ status: "ok", stale: true, staleSourceIds: ["s1"] });
    expect(calls).toEqual([
      HEALTH_ENDPOINT,
      ATLAS_ENDPOINT,
      `${ATLAS_BOARD_ENDPOINT}web--checkout`,
    ]);
    for (const call of fetchImpl.mock.calls) expect(call[1]?.method ?? "GET").toBe("GET");
  });

  it("reads how many Figma frames of a board have a cached image, zero when absent or malformed", async () => {
    const reply = (references: unknown) =>
      vi.fn<typeof fetch>(async () => Response.json({ scene, status: "ok", references }));
    const counted = await fetchAtlasBoard("web--users", reply({ frames: 2, cached: 1 }));
    expect(counted.status === "ok" && counted.references).toEqual({ frames: 2, cached: 1 });
    for (const bad of [undefined, "2", { frames: -1, cached: 1.5 }]) {
      const board = await fetchAtlasBoard("web--users", reply(bad));
      expect(board.status === "ok" && board.references).toEqual({ frames: 0, cached: 0 });
    }
  });

  it("asks no server in the hosted editor, which has none", async () => {
    const fetchImpl = respond(200, { ok: true, atlas: true });
    expect(await fetchHealth(fetchImpl, false, true)).toEqual({ atlas: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats a server without an atlas or an unreachable one as no atlas", async () => {
    expect(await fetchHealth(respond(200, { ok: true }))).toEqual({ atlas: false });
    expect(
      await fetchHealth(vi.fn<typeof fetch>(async () => Promise.reject(new Error("down")))),
    ).toEqual({
      atlas: false,
    });
  });

  it("asks for a token on 401, then sends the saved one when the call is retried", async () => {
    const first = await fetchAtlas(respond(401, { error: "unauthorized" }));
    expect(first).toEqual({ status: "unauthorized", rejected: false });
    saveToken("tok-1");
    const retry = respond(200, atlas);
    expect((await fetchAtlas(retry)).status).toBe("ok");
    expect(sentHeaders(retry).Authorization).toBe("Bearer tok-1");
  });

  it("drops the stored token only when the refused request carried it", async () => {
    saveToken("old");
    let resolve!: (r: Response) => void;
    const pending = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    const call = fetchAtlas(pending);
    saveToken("new"); // entered while the old request was in flight
    resolve(new Response("{}", { status: 401 }));
    expect(await call).toEqual({ status: "unauthorized", rejected: true });
    expect(readToken()).toBe("new");
    expect(await fetchAtlas(respond(401, {}))).toEqual({ status: "unauthorized", rejected: true });
    expect(readToken()).toBeNull();
  });

  it("maps board errors: 404 not found, 422 issues, 503 busy", async () => {
    expect(await fetchAtlasBoard("nope", respond(404, { error: "no such board" }))).toEqual({
      status: "not-found",
    });
    const issues = [{ path: "nodes[0].ref", message: "bad" }];
    expect(await fetchAtlasBoard("bad", respond(422, { status: "invalid", issues }))).toEqual({
      status: "invalid",
      issues,
      warnings: [],
    });
    expect(await fetchAtlasBoard("busy", respond(503, { error: "busy now" }))).toEqual({
      status: "error",
      message: "busy now",
    });
  });

  it("encodes the slug into the path", async () => {
    const fetchImpl = respond(404, {});
    await fetchAtlasBoard("a b", fetchImpl);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(`${ATLAS_BOARD_ENDPOINT}a%20b`);
  });
});

describe("atlas payload of the spec-stage fixture", () => {
  // Served by /api/atlas (publicAtlas) and kept equal to it by the server's own test, so the
  // viewer reads exactly what the server sends.
  const payload = JSON.parse(
    readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../examples/fixtures/lifecycle/spec-public-atlas.json",
      ),
      "utf8",
    ),
  );

  it("reads grounding, spec-only claims and unchecked sources", () => {
    const atlas = toAtlas(payload);
    expect(atlas?.boards.map((b) => [b.slug, b.grounding, b.uncheckedSources])).toEqual([
      ["overview-web", { code: 0, spec: 5, none: 0 }, 2],
      ["web--signup", { code: 0, spec: 6, none: 1 }, 0],
    ]);
    expect(atlas?.boards[1]?.specOnly).toContain("nodes[3]");
    expect(atlas?.boards[1]?.specOnlyTruncated).toBe(false);
    expect(atlas?.boards[1]?.tags).toEqual(["onboarding"]);
    expect(atlas?.boards[0]?.layoutFrom).toEqual(["mockup", "figma", "doc"]);
  });

  it("reads every field the server sends for a board, and no field it does not", () => {
    const atlas = toAtlas(payload);
    const served = Object.keys(payload.boards[0]).sort();
    const read = Object.keys(atlas?.boards[0] ?? {})
      .filter((k) => k !== "issues")
      .sort();
    expect(read).toEqual(served);
  });

  it("falls back to zero counts for a malformed grounding", () => {
    const atlas = toAtlas({
      boards: [{ slug: "a", title: "A", grounding: { code: -1, spec: "x" } }],
      refs: [],
    });
    expect(atlas?.boards[0]?.grounding).toEqual({ code: 0, spec: 0, none: 0 });
  });
});

describe("needsFlow", () => {
  it("keeps needsFlow only when it is true", () => {
    const index = toAtlas({
      boards: [],
      refs: [
        { ref: "web:a/b", definedIn: [], usedIn: [], needsFlow: true },
        { ref: "web:a/c", definedIn: [], usedIn: [], needsFlow: "yes" },
        { ref: "web:a/d", definedIn: [], usedIn: [] },
      ],
    });
    expect(index?.refs.map((r) => r.needsFlow)).toEqual([true, undefined, undefined]);
    expect(index?.refs[1]).not.toHaveProperty("needsFlow");
  });
});

describe("label and role of a place", () => {
  it("keeps a label and a known role, and loads an index written without them", () => {
    const index = toAtlas({
      boards: [],
      refs: [
        {
          ref: "web:layout-header/header-logout",
          definedIn: [
            {
              slug: "web--layout-header",
              nodeId: "logout",
              label: "ログアウト (Đăng xuất)",
              role: "button",
            },
          ],
          usedIn: [],
        },
        {
          ref: "web:a/b",
          definedIn: [
            { slug: "web--a", nodeId: "b", label: 3, role: "slider" },
            { slug: "web--a", nodeId: "c", label: "   " },
            { slug: "web--a", nodeId: "d" },
          ],
          usedIn: [],
        },
      ],
    });
    expect(index?.refs[0]?.definedIn).toEqual([
      {
        slug: "web--layout-header",
        nodeId: "logout",
        label: "ログアウト (Đăng xuất)",
        role: "button",
      },
    ]);
    expect(index?.refs[1]?.definedIn).toEqual([
      { slug: "web--a", nodeId: "b" },
      { slug: "web--a", nodeId: "c" },
      { slug: "web--a", nodeId: "d" },
    ]);
  });
});

describe("export stamp", () => {
  const stamp = {
    checkedAt: "2026-11-20T07:00:00.000Z",
    commit: "4f5a346",
    dirty: true,
    version: "0.1.0",
  };

  it("keeps a valid stamp, a null commit included", () => {
    expect(toAtlas({ boards: [], refs: [], exported: stamp })?.exported).toEqual(stamp);
    const outside = { ...stamp, commit: null, dirty: false };
    expect(toAtlas({ boards: [], refs: [], exported: outside })?.exported).toEqual(outside);
  });

  it.each([
    ["no stamp", undefined],
    ["a string", "yesterday"],
    ["a bad date", { ...stamp, checkedAt: "not a date" }],
    ["a forged commit", { ...stamp, commit: "<img src=x>" }],
    ["a string dirty flag", { ...stamp, dirty: "yes" }],
    ["no version", { ...stamp, version: undefined }],
  ])("drops %s", (_label, exported) => {
    const atlas = toAtlas({ boards: [], refs: [], exported });
    expect(atlas).not.toBeNull();
    expect(atlas && "exported" in atlas).toBe(false);
  });
});

describe("static mode", () => {
  it("has an atlas without asking any server", async () => {
    const fetchImpl = respond(500, {});
    expect(await fetchHealth(fetchImpl, true)).toEqual({ atlas: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads the atlas from data/atlas.json, never with a token", async () => {
    saveToken("secret");
    const fetchImpl = respond(200, { boards: [], refs: [], problems: [] });
    expect(await fetchAtlas(fetchImpl, true)).toEqual({
      status: "ok",
      atlas: { boards: [], refs: [], problems: [] },
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(STATIC_ATLAS_URL);
    expect(sentHeaders(fetchImpl).Authorization).toBeUndefined();
    expect(STATIC_ATLAS_URL).toBe("./data/atlas.json");
  });

  it("says the export has no data when atlas.json is missing", async () => {
    expect(await fetchAtlas(respond(404, "not found"), true)).toEqual({
      status: "error",
      message: "This export has no atlas data.",
    });
  });

  it("reads a board from data/boards/<slug>.json", async () => {
    const fetchImpl = respond(200, {
      scene,
      status: "stale",
      warnings: [],
      staleSourceIds: ["s1"],
      references: { frames: 2, cached: 1 },
    });
    const result = await fetchAtlasBoard("web--checkout", fetchImpl, true);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`${STATIC_BOARD_URL}web--checkout.json`);
    expect(result).toMatchObject({
      status: "ok",
      stale: true,
      staleSourceIds: ["s1"],
      references: { frames: 2, cached: 1 },
    });
  });

  it("reads an invalid board file as invalid, and a missing one as not found", async () => {
    const invalid = respond(200, {
      status: "invalid",
      issues: [{ path: "nodes[0]", message: "bad" }],
      warnings: ["w"],
    });
    expect(await fetchAtlasBoard("broken", invalid, true)).toEqual({
      status: "invalid",
      issues: [{ path: "nodes[0]", message: "bad" }],
      warnings: ["w"],
    });
    expect(await fetchAtlasBoard("gone", respond(404, "not found"), true)).toEqual({
      status: "not-found",
    });
  });

  it.each(["..", "../atlas", "a/b", ".env", "a.b", "", `${"x".repeat(101)}`])(
    "never fetches the slug %j",
    async (slug) => {
      const fetchImpl = respond(200, {});
      expect(await fetchAtlasBoard(slug, fetchImpl, true)).toEqual({ status: "not-found" });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
});

describe("board tags", () => {
  afterEach(() => clearToken());

  it("PUTs the tags as JSON with the stored token and returns what the server kept", async () => {
    saveToken("tok");
    const fetchImpl = respond(200, { ok: true, tags: ["auth"] });
    expect(await saveBoardTags("web--login", ["auth"], fetchImpl)).toEqual({
      status: "ok",
      tags: ["auth"],
    });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(`${ATLAS_BOARD_ENDPOINT}web--login/tags`);
    expect(init?.method).toBe("PUT");
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer tok",
    });
    expect(JSON.parse(String(init?.body))).toEqual({ tags: ["auth"] });
  });

  it("reports a refused token, a server error and a bad slug without sending it", async () => {
    saveToken("old");
    expect(await saveBoardTags("a", ["x"], respond(401, {}))).toEqual({
      status: "unauthorized",
      rejected: true,
    });
    expect(await saveBoardTags("a", ["x"], respond(422, { error: "tags must be unique" }))).toEqual(
      {
        status: "error",
        message: "tags must be unique",
      },
    );
    const never = respond(200, {});
    expect((await saveBoardTags("../x", ["x"], never)).status).toBe("error");
    expect(never).not.toHaveBeenCalled();
  });

  it("offers editing only when the server says so and the page is not an export", () => {
    expect(toAtlas({ boards: [], refs: [], tagsEditable: true })?.tagsEditable).toBe(true);
    expect(toAtlas({ boards: [], refs: [] })?.tagsEditable).toBeUndefined();
    const stamp = { checkedAt: "2026-11-20T00:00:00Z", commit: null, dirty: false, version: "1" };
    expect(
      toAtlas({ boards: [], refs: [], tagsEditable: true, exported: stamp })?.tagsEditable,
    ).toBeUndefined();
  });
});
