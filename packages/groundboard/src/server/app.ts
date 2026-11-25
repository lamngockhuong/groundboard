import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LayoutTimeoutError } from "@groundboard/layout";
import { LIMITS, parseBoard, parseOverlay } from "@groundboard/schema";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { createMcpHandler, localhostAllowedHostnames } from "@modelcontextprotocol/server";
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import {
  type AtlasIndex,
  atlasIdOf,
  BOARD_SLUG,
  buildAtlas,
  MAX_BOARD_FILE_BYTES,
} from "../atlas.ts";
import { renderAtlasBoard } from "../atlas-board.ts";
import { buildAtlasZip } from "../atlas-zip.ts";
import { writeBoardTags } from "../board-tags.ts";
import { etagOf, writeAtlasFile } from "../board-write.ts";
import { BOARD_FILE_SUFFIX, readConfined } from "../fs-confined.ts";
import { buildServer } from "../mcp/server.ts";
import type { RenderFn } from "../mcp/tools.ts";
import { OVERLAY_FILE_SUFFIX } from "../overlay-file.ts";
import { renderBoard, validateBoard } from "../pipeline.ts";
import { VERSION } from "../version.ts";
import { BusyError, ClientBusyError, createGate, createPerKeyLimit } from "./gate.ts";
import { clientKey, RateLimiter, trustedProxies } from "./rate-limit.ts";

export const MAX_BODY_BYTES = 1024 * 1024;
/** An overlay PUT: the overlay file's own limit and room for the JSON around it. */
export const MAX_OVERLAY_BODY_BYTES = LIMITS.overlayBytes + 64 * 1024;
/** A board PUT: the board file's own limit and room for the JSON around it. */
export const MAX_BOARD_BODY_BYTES = MAX_BOARD_FILE_BYTES + 64 * 1024;

export interface AppOptions {
  /** Address the server binds to; localhost binds get Host and Origin checks by default. */
  host?: string;
  /** Hostnames allowed in `Host` and browser `Origin` headers (GROUNDBOARD_ALLOWED_HOSTS). */
  allowedHosts?: string[];
  /** Bearer token required on /api/* and /mcp (GROUNDBOARD_TOKEN); anonymous when unset. */
  token?: string;
  /** Proxies whose `X-Forwarded-For` is believed (CIDRs). */
  trustProxy?: string[];
  /** Directory holding the built viewer; defaults to `web/` next to this module. */
  webRoot?: string;
  layoutTimeoutMs?: number;
  maxConcurrentLayouts?: number;
  maxQueuedLayouts?: number;
  rateLimit?: { limit: number; windowMs: number; maxKeys: number };
  /** Replaces the worker-backed pipeline in tests. */
  render?: RenderFn;
  /**
   * Serve the screen atlas from `dir` (its `*.board.json` files), checking sources against
   * `root`. Both are real paths the caller already confined; no request picks a directory.
   * Without it the server reads no files. The one write it allows, a board's tags, is open only
   * on a loopback bind: the person tagging is the one whose files they are.
   */
  atlas?: { dir: string; root: string };
}

/** Whether a bind address only accepts connections from this machine. */
export function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/** The atlas index as HTTP returns it: a stale board says which sources broke, not why. */
export function publicAtlas(index: AtlasIndex) {
  return {
    ...index,
    boards: index.boards.map(({ issues, ...board }) =>
      board.status === "invalid" ? { ...board, issues } : board,
    ),
  };
}

export interface GroundboardApp {
  app: ReturnType<typeof createMcpHonoApp>;
  close: () => Promise<void>;
}

const defaultWebRoot = () => fileURLToPath(new URL("./web", import.meta.url));

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time bearer check; compares SHA-256 digests so lengths never leak. */
function bearerAuth(token: string): MiddlewareHandler {
  const expected = digest(token);
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const match = /^Bearer (.+)$/i.exec(header);
    const given = digest(match?.[1] ?? "");
    if (!match || !timingSafeEqual(given, expected)) {
      c.header("WWW-Authenticate", 'Bearer realm="groundboard"');
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}

async function readBoardRequest(
  c: Context,
): Promise<{ board: unknown; direction?: "right" | "down" } | { error: string }> {
  let body: unknown;
  try {
    body = c.get("parsedBody" as never) ?? (await c.req.json());
  } catch {
    return { error: "the request body must be JSON" };
  }
  if (typeof body !== "object" || body === null || !("board" in body)) {
    return {
      error: 'the request body must be { "board": <board IR>, "direction"?: "right" | "down" }',
    };
  }
  const { board, direction } = body as { board: unknown; direction?: unknown };
  if (direction !== undefined && direction !== "right" && direction !== "down") {
    return { error: 'direction must be "right" or "down"' };
  }
  return direction === undefined ? { board } : { board, direction };
}

/**
 * The HTTP server: viewer, render API and stateless MCP endpoint. It reads no files unless
 * started with `atlas`, stores nothing and lays boards out in worker threads behind a small
 * queue, so `/healthz` always answers.
 */
export function createApp(options: AppOptions = {}): GroundboardApp {
  const host = options.host ?? "127.0.0.1";
  const atlas = options.atlas;
  // Reading project files for anyone who can reach the port needs both a token and a host list.
  if (atlas && !isLoopbackHost(host) && (!options.token || !options.allowedHosts?.length)) {
    throw new Error(
      `--atlas on ${host} reads project files for anyone who can reach it; set both GROUNDBOARD_TOKEN and GROUNDBOARD_ALLOWED_HOSTS, or bind to 127.0.0.1`,
    );
  }
  // Localhost names stay allowed next to the public ones, so the container's own health check
  // (Host: 127.0.0.1) passes; a DNS-rebinding page always sends its own hostname instead.
  const allowedHosts = options.allowedHosts?.length
    ? [...new Set([...options.allowedHosts, ...localhostAllowedHostnames()])]
    : undefined;
  // The MCP app parses JSON bodies for every route, ahead of the per-route limits below. It
  // takes a whole board only where the board save route exists: an atlas on a loopback bind.
  const app = createMcpHonoApp({
    host,
    ...(allowedHosts ? { allowedHosts, allowedOrigins: allowedHosts } : {}),
    maxRequestBodySize: atlas && isLoopbackHost(host) ? MAX_BOARD_BODY_BYTES : MAX_BODY_BYTES,
  });

  const gate = createGate(options.maxConcurrentLayouts ?? 2, options.maxQueuedLayouts ?? 8);
  const timeoutMs = options.layoutTimeoutMs ?? 5000;
  const baseRender: RenderFn =
    options.render ??
    ((input, opts) => renderBoard(input, { ...opts, workerTimeoutMs: timeoutMs }));
  // One layout in flight per client, so no single client can hold every slot of the gate.
  const perClient = createPerKeyLimit(1);
  const client = new AsyncLocalStorage<string>();
  // Never read files from /api/render or /mcp, whatever the caller passes.
  const render: RenderFn = (input, opts) =>
    perClient(client.getStore() ?? "unknown", () =>
      gate(() => baseRender(input, { ...(opts.direction ? { direction: opts.direction } : {}) })),
    );
  // The atlas routes read files, but only under the root the server was started with. Reading,
  // parsing and laying out a board all hold the client's slot and a gate slot.
  const withAtlasSlot = <T>(task: () => Promise<T>) =>
    perClient(client.getStore() ?? "unknown", () => gate(task));
  // Concurrent GET /api/atlas share one build, so at most one runs at a time server-wide; it
  // takes a gate slot but not the client's layout slot, so a viewer can load the index and a
  // board at once. Each build reads the files afresh.
  let atlasBuild: Promise<AtlasIndex> | null = null;
  const readAtlas = (dir: string, root: string): Promise<AtlasIndex> => {
    if (atlasBuild) return atlasBuild;
    const build = gate(() => buildAtlas(dir, root)).finally(() => {
      atlasBuild = null;
    });
    atlasBuild = build;
    return build;
  };

  const rate = options.rateLimit ?? { limit: 60, windowMs: 60_000, maxKeys: 10_000 };
  const limiter = new RateLimiter(rate);
  const trusted = options.trustProxy?.length ? trustedProxies(options.trustProxy) : undefined;

  const mcp = createMcpHandler(() => buildServer({ fileAccess: false, render }), {
    onerror: (error) => console.error(`groundboard serve: mcp: ${error.message}`),
  });

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        // The viewer submits no forms; without this a form could post anywhere.
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
    }),
  );

  app.get("/healthz", (c) => c.json({ ok: true, version: VERSION, atlas: atlas !== undefined }));

  const limit = (maxSize: number) =>
    bodyLimit({
      maxSize,
      onError: (c) => c.json({ error: `the request body is larger than ${maxSize} bytes` }, 413),
    });
  const defaultLimit = limit(MAX_BODY_BYTES);
  const overlayLimit = limit(MAX_OVERLAY_BODY_BYTES);
  const boardLimit = limit(MAX_BOARD_BODY_BYTES);
  // Every route takes 1 MB but the writes of a larger file, each on its own path and method.
  const bodyLimitFor: MiddlewareHandler = (c, next) => {
    if (c.req.method !== "PUT") return defaultLimit(c, next);
    if (/^\/api\/atlas\/boards\/[^/]+\/overlay$/.test(c.req.path)) return overlayLimit(c, next);
    if (/^\/api\/atlas\/boards\/[^/]+$/.test(c.req.path)) return boardLimit(c, next);
    return defaultLimit(c, next);
  };
  const guarded: MiddlewareHandler[] = [
    bodyLimitFor,
    async (c, next) => {
      let socket: string | undefined;
      try {
        socket = getConnInfo(c).remote.address;
      } catch {
        socket = undefined;
      }
      const key = clientKey(socket, c.req.header("x-forwarded-for"), trusted);
      if (!limiter.hit(key)) {
        c.header("Retry-After", String(Math.ceil(rate.windowMs / 1000)));
        return c.json({ error: "too many requests" }, 429);
      }
      await client.run(key, next);
    },
  ];
  if (options.token) guarded.push(bearerAuth(options.token));
  for (const route of ["/api/*", "/mcp"]) app.use(route, ...guarded);

  const busy = (c: Context, error: unknown) => {
    if (error instanceof ClientBusyError) {
      c.header("Retry-After", "5");
      return c.json({ error: error.message }, 429);
    }
    if (error instanceof BusyError || error instanceof LayoutTimeoutError) {
      c.header("Retry-After", "5");
      return c.json({ error: error.message }, 503);
    }
    throw error;
  };

  app.post("/api/render", async (c) => {
    const request = await readBoardRequest(c);
    if ("error" in request) return c.json({ error: request.error }, 400);
    try {
      const result = await render(
        request.board,
        request.direction ? { direction: request.direction } : {},
      );
      if (!result.ok || !result.scene) {
        return c.json({ ok: false, issues: result.issues, warnings: result.warnings }, 422);
      }
      return c.json({ ok: true, scene: result.scene, issues: [], warnings: result.warnings });
    } catch (error) {
      return busy(c, error);
    }
  });

  app.post("/api/validate", async (c) => {
    const request = await readBoardRequest(c);
    if ("error" in request) return c.json({ error: request.error }, 400);
    const result = await validateBoard(request.board);
    return c.json({ ok: result.ok, issues: result.issues, warnings: result.warnings });
  });

  if (atlas) {
    const tagsEditable = isLoopbackHost(host);
    const atlasId = atlasIdOf(atlas.root);

    app.get("/api/atlas", async (c) => {
      try {
        const index = { ...publicAtlas(await readAtlas(atlas.dir, atlas.root)), atlasId };
        return c.json(tagsEditable ? { ...index, tagsEditable } : index);
      } catch (error) {
        if (error instanceof Error && "code" in error) {
          return c.json({ error: "the atlas directory cannot be read" }, 500);
        }
        return busy(c, error);
      }
    });

    // The board file as written, for the viewer to put in a zip or to compare before a save.
    // One bounded read: it takes no atlas slot.
    app.get("/api/atlas/boards/:slug/source", async (c) => {
      const slug = c.req.param("slug");
      if (!BOARD_SLUG.test(slug)) return c.json({ error: "invalid board name" }, 400);
      const read = await readConfined(
        atlas.dir,
        `${slug}${BOARD_FILE_SUFFIX}`,
        { remaining: MAX_BOARD_FILE_BYTES },
        MAX_BOARD_FILE_BYTES,
        { noSymlink: true },
      );
      if (!read.ok) return c.json({ error: "no such board" }, 404);
      c.header("ETag", `"${etagOf(read.text)}"`);
      c.header("Cache-Control", "no-store");
      return c.body(read.text, 200, { "Content-Type": "application/json; charset=utf-8" });
    });

    // Every board file in one zip, so a download does not cost one request per board against
    // the rate limit. `include=excalidraw` adds each board rendered, which holds the slot.
    app.get("/api/atlas/export.zip", async (c) => {
      const includeScenes = c.req.query("include") === "excalidraw";
      try {
        const zip = await withAtlasSlot(() =>
          buildAtlasZip(atlas.dir, atlas.root, { scenes: includeScenes, render: baseRender }),
        );
        c.header("Cache-Control", "no-store");
        c.header("Content-Disposition", 'attachment; filename="groundboard-atlas.zip"');
        return c.body(zip as Uint8Array<ArrayBuffer>, 200, { "Content-Type": "application/zip" });
      } catch (error) {
        if (error instanceof Error && "code" in error) {
          return c.json({ error: "the atlas directory cannot be read" }, 500);
        }
        return busy(c, error);
      }
    });

    app.get("/api/atlas/boards/:slug", async (c) => {
      // Checked after Hono decoded the parameter, so `%2e%2e` is `..` here and fails.
      const slug = c.req.param("slug");
      if (!BOARD_SLUG.test(slug)) return c.json({ error: "invalid board name" }, 400);
      // Reference images are drawn unless the viewer asks for the board without them.
      const references = c.req.query("references") !== "0";
      try {
        const { status, body } = await withAtlasSlot(() =>
          renderAtlasBoard(atlas.dir, atlas.root, slug, { references, render: baseRender }),
        );
        return c.json(body, status);
      } catch (error) {
        return busy(c, error);
      }
    });
  }

  // Writes are routes only on a loopback bind: the person editing is the one whose files they
  // are. Elsewhere the routes do not exist, and the viewer keeps edits as drafts in the browser.
  if (atlas && isLoopbackHost(host)) {
    /** The JSON body of a write; a form or a no-preflight fetch from another site cannot send it. */
    const readWrite = async (
      c: Context,
    ): Promise<{ body: Record<string, unknown> } | { response: Response }> => {
      if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
        return { response: c.json({ error: "the request body must be JSON" }, 415) };
      }
      try {
        const body: unknown = await c.req.json();
        if (typeof body === "object" && body !== null && !Array.isArray(body)) {
          return { body: body as Record<string, unknown> };
        }
      } catch {
        // Answered below.
      }
      return { response: c.json({ error: "the request body must be a JSON object" }, 400) };
    };
    /** `expectedEtag`: a SHA-256 in hex, null for a file that must not exist yet, or absent. */
    const expectedEtagOf = (body: Record<string, unknown>): string | null | undefined | false => {
      const value = body.expectedEtag;
      if (value === undefined || value === null) return value;
      return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : false;
    };

    app.put("/api/atlas/boards/:slug/tags", async (c) => {
      const read = await readWrite(c);
      if ("response" in read) return read.response;
      if (!("tags" in read.body)) {
        return c.json({ error: 'the request body must be { "tags": string[] }' }, 400);
      }
      const expected = expectedEtagOf(read.body);
      if (expected === false) return c.json({ error: "expectedEtag must be a SHA-256" }, 400);
      const result = await writeBoardTags(atlas.dir, c.req.param("slug"), read.body.tags, expected);
      return result.ok
        ? c.json({ ok: true, tags: result.tags, etag: result.etag })
        : c.json(
            { error: result.error, ...(result.etag !== undefined ? { etag: result.etag } : {}) },
            result.status,
          );
    });

    app.put("/api/atlas/boards/:slug", async (c) => {
      const read = await readWrite(c);
      if ("response" in read) return read.response;
      const expected = expectedEtagOf(read.body);
      if (expected === false) return c.json({ error: "expectedEtag must be a SHA-256" }, 400);
      if (expected === undefined || expected === null) {
        return c.json({ error: "a board save needs the expectedEtag of the file it changes" }, 400);
      }
      // Checked before the board's lock is taken. The board is written as the viewer sent it:
      // parsing fills in defaults, and the file keeps what its writer wrote.
      const parsed = parseBoard(read.body.board);
      if (!parsed.ok) return c.json({ error: "the board is invalid", issues: parsed.error }, 422);
      const text = `${JSON.stringify(read.body.board, null, 2)}\n`;
      try {
        const result = await withAtlasSlot(() =>
          writeAtlasFile(
            atlas.dir,
            c.req.param("slug"),
            "board",
            () => ({ ok: true, text }),
            expected,
          ),
        );
        return result.ok
          ? c.json({ ok: true, etag: result.etag })
          : c.json(
              { error: result.error, ...(result.etag !== undefined ? { etag: result.etag } : {}) },
              result.status,
            );
      } catch (error) {
        return busy(c, error);
      }
    });

    app.get("/api/atlas/boards/:slug/overlay", async (c) => {
      const slug = c.req.param("slug");
      if (!BOARD_SLUG.test(slug)) return c.json({ error: "invalid board name" }, 400);
      const read = await readConfined(
        atlas.dir,
        `${slug}${OVERLAY_FILE_SUFFIX}`,
        { remaining: LIMITS.overlayBytes },
        LIMITS.overlayBytes,
        { noSymlink: true },
      );
      if (!read.ok) return c.json({ error: "no overlay" }, 404);
      c.header("ETag", `"${etagOf(read.text)}"`);
      c.header("Cache-Control", "no-store");
      return c.body(read.text, 200, { "Content-Type": "application/json; charset=utf-8" });
    });

    app.put("/api/atlas/boards/:slug/overlay", async (c) => {
      const read = await readWrite(c);
      if ("response" in read) return read.response;
      const expected = expectedEtagOf(read.body);
      if (expected === false) return c.json({ error: "expectedEtag must be a SHA-256" }, 400);
      // Checked before the board's lock is taken, and before anything is read.
      const parsed = parseOverlay(read.body.overlay);
      if (!parsed.ok) {
        return c.json({ error: "the overlay is invalid", issues: parsed.error }, 422);
      }
      const text = `${JSON.stringify(parsed.value, null, 2)}\n`;
      try {
        const result = await withAtlasSlot(() =>
          writeAtlasFile(
            atlas.dir,
            c.req.param("slug"),
            "overlay",
            () => ({ ok: true, text }),
            expected,
          ),
        );
        return result.ok
          ? c.json({ ok: true, etag: result.etag })
          : c.json(
              {
                error: result.error,
                ...(result.issues ? { issues: result.issues } : {}),
                ...(result.etag !== undefined ? { etag: result.etag } : {}),
              },
              result.status,
            );
      } catch (error) {
        return busy(c, error);
      }
    });
  }

  app.all("/mcp", (c) => mcp.fetch(c.req.raw, { parsedBody: c.get("parsedBody" as never) }));

  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  const webRoot = options.webRoot ?? defaultWebRoot();
  if (existsSync(path.join(webRoot, "index.html"))) {
    app.use("/*", serveStatic({ root: webRoot }));
    app.get("*", serveStatic({ root: webRoot, path: "index.html" }));
  } else {
    app.get("/", (c) =>
      c.text("groundboard: the viewer is not built; POST /api/render and /mcp still work.\n", 200),
    );
  }

  app.onError((error, c) => {
    console.error(`groundboard serve: ${error instanceof Error ? error.message : String(error)}`);
    return c.json({ error: "internal error" }, 500);
  });

  return { app, close: () => mcp.close() };
}
