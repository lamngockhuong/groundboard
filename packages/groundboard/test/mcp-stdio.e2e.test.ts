// Spawns the built CLI's stdio MCP server (run `pnpm -r build` first) and talks raw JSON-RPC,
// once as a current stateless client (protocol version in `_meta`, no `initialize`) and once
// through the 2025-era `initialize` handshake.
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, describe, expect, test } from "vitest";

const packageDir = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(packageDir, "../..");
const cli = path.join(packageDir, "dist", "cli.mjs");
const board = JSON.parse(
  readFileSync(path.join(repoRoot, "examples", "checkout-flow.board.json"), "utf8"),
);

let child: ChildProcessWithoutNullStreams | undefined;
afterEach(() => child?.kill());
afterAll(() =>
  rmSync(path.join(repoRoot, ".groundboard", "stdio-e2e.excalidraw"), { force: true }),
);

function startServer() {
  if (!existsSync(cli)) throw new Error(`${cli} is missing; run "pnpm -r build" first`);
  const proc = spawn(process.execPath, [cli, "mcp"], {
    cwd: repoRoot,
    env: { ...process.env, GROUNDBOARD_ROOT: repoRoot },
  });
  child = proc;
  const waiting = new Map<number, (message: Record<string, unknown>) => void>();
  let buffer = "";
  proc.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    for (let nl = buffer.indexOf("\n"); nl !== -1; nl = buffer.indexOf("\n")) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const message = JSON.parse(line) as Record<string, unknown>;
      const resolve = waiting.get(message.id as number);
      if (resolve) {
        waiting.delete(message.id as number);
        resolve(message);
      }
    }
  });
  const send = (message: Record<string, unknown>) =>
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const request = (id: number, method: string, params: Record<string, unknown>) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 20_000);
      waiting.set(id, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      send({ id, method, params });
    });
  return { send, request };
}

const renderArgs = {
  name: "render_board",
  arguments: { board, checkSourcesRoot: ".", outputPath: ".groundboard/stdio-e2e.excalidraw" },
};

function expectRendered(response: Record<string, unknown>) {
  expect(response.error, JSON.stringify(response.error)).toBeUndefined();
  const result = response.result as { isError?: boolean; structuredContent?: { path?: string } };
  expect(result.isError, JSON.stringify(result)).toBeFalsy();
  expect(result.structuredContent?.path).toBe(path.join(".groundboard", "stdio-e2e.excalidraw"));
}

describe("groundboard mcp over stdio", () => {
  test("serves a stateless 2026-07-28 request without initialize", async () => {
    const { request } = startServer();
    const response = await request(1, "tools/call", {
      ...renderArgs,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "e2e", version: "0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    });
    expectRendered(response);
  }, 30_000);

  test("serves a 2025-era client through the initialize handshake", async () => {
    const { request, send } = startServer();
    const init = await request(1, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "e2e-legacy", version: "0" },
    });
    expect((init.result as { serverInfo: { name: string } }).serverInfo.name).toBe("groundboard");
    send({ method: "notifications/initialized" });
    expectRendered(await request(2, "tools/call", renderArgs));
  }, 30_000);

  test("checks an atlas directory inside the root", async () => {
    const { request } = startServer();
    const response = await request(1, "tools/call", {
      name: "check_atlas",
      arguments: { dir: "examples", checkSourcesRoot: "." },
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "e2e", version: "0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    });
    expect(response.error, JSON.stringify(response.error)).toBeUndefined();
    const result = response.result as {
      isError?: boolean;
      structuredContent?: { boards: Array<{ slug: string; status: string }> };
    };
    expect(result.isError, JSON.stringify(result)).toBeFalsy();
    expect(result.structuredContent?.boards.map((b) => [b.slug, b.status])).toEqual([
      ["checkout-flow", "ok"],
      ["order-state-machine", "ok"],
    ]);
  }, 30_000);

  test("check_atlas takes require and baseline, and refuses a baseline outside the root", async () => {
    const { request } = startServer();
    const meta = {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "e2e", version: "0" },
      "io.modelcontextprotocol/clientCapabilities": {},
    };
    const spec = "examples/fixtures/lifecycle/spec";
    const call = async (id: number, extra: Record<string, unknown>) => {
      const response = await request(id, "tools/call", {
        name: "check_atlas",
        arguments: { dir: `${spec}/.groundboard`, checkSourcesRoot: spec, ...extra },
        _meta: meta,
      });
      expect(response.error, JSON.stringify(response.error)).toBeUndefined();
      return response.result as {
        isError?: boolean;
        content: Array<{ text: string }>;
        structuredContent?: {
          problems?: Array<{ path: string; message: string }>;
          boards?: Array<{ grounding: Record<string, number> }>;
        };
      };
    };
    const same = await call(1, { require: "spec", baseline: `${spec}/.groundboard` });
    expect(same.isError).toBe(true);
    expect(same.structuredContent?.problems).toEqual([
      expect.objectContaining({ path: "web--signup.board.json" }),
    ]);
    expect(same.structuredContent?.boards?.[1]?.grounding).toEqual({ code: 0, spec: 6, none: 1 });
    const outside = await call(2, { baseline: ".." });
    expect(outside.isError).toBe(true);
    expect(outside.content[0]?.text).toBe(
      "baseline must be the project root or a directory inside it",
    );
  }, 30_000);
});
